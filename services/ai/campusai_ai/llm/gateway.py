"""Provider-agnostic LLM gateway: tiers, fallback chains, cooldowns, streaming, structured output with repair."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Type, TypeVar

import httpx
import yaml
from pydantic import BaseModel, ValidationError

from ..config import get_settings
from ..errors import LLMError, NotConfigured

T = TypeVar("T", bound=BaseModel)

COOLDOWN_429 = 60.0
COOLDOWN_AUTH = 600.0
PRIVATE_OK = {"local", "no_training"}


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str | None
    privacy: str
    needs_key: bool

    @property
    def usable(self) -> bool:
        return (not self.needs_key) or bool(self.api_key)


@dataclass
class LLMResult:
    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0


@dataclass
class StreamChunk:
    text: str = ""
    done: bool = False
    model: str = ""
    tokens_in: int = 0
    tokens_out: int = 0


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def extract_json(text: str) -> Any:
    """Tolerant JSON extraction: strips code fences and finds the first balanced object/array."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE | re.MULTILINE).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = t.find(open_c)
        while start != -1:
            depth, in_str, esc = 0, False, False
            for i in range(start, len(t)):
                ch = t[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == open_c:
                    depth += 1
                elif ch == close_c:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(t[start : i + 1])
                        except Exception:
                            break
            start = t.find(open_c, start + 1)
    raise ValueError("no valid JSON found in model output")


class LLMGateway:
    def __init__(self, config_path: str | None = None, client: httpx.AsyncClient | None = None):
        s = get_settings()
        with open(config_path or s.llm_config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        self.providers: dict[str, Provider] = {}
        for name, p in cfg["providers"].items():
            base = os.environ.get(p.get("base_url_env") or "", "") or p["base_url"]
            key_env = p.get("api_key_env")
            self.providers[name] = Provider(
                name=name,
                base_url=base.rstrip("/"),
                api_key=os.environ.get(key_env) if key_env else None,
                privacy=p.get("privacy", "unknown"),
                needs_key=bool(key_env),
            )
        self.tiers: dict[str, list[str]] = {}
        for tier, chain in cfg["tiers"].items():
            env = os.environ.get(f"LLM_{tier.upper()}")
            self.tiers[tier] = [x.strip() for x in env.split(",") if x.strip()] if env else list(chain)
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0))
        self._cooldown: dict[str, float] = {}
        self._ollama_ok: tuple[float, bool] = (0.0, False)

    # ----- availability -----
    async def _ollama_reachable(self) -> bool:
        ts, ok = self._ollama_ok
        if time.time() - ts < 30:
            return ok
        p = self.providers.get("ollama")
        ok = False
        if p:
            try:
                r = await self.client.get(p.base_url + "/models", timeout=1.5)
                ok = r.status_code == 200
            except Exception:
                ok = False
        self._ollama_ok = (time.time(), ok)
        return ok

    async def health(self) -> dict:
        provs: dict[str, str] = {}
        configured = False
        for name, p in self.providers.items():
            if name == "ollama":
                up = await self._ollama_reachable()
                provs[name] = "ok" if up else "unreachable"
                configured = configured or up
            elif p.usable:
                cd = self._cooldown.get(name, 0) > time.time()
                provs[name] = "cooldown" if cd else "ok"
                configured = True
            else:
                provs[name] = "no_key"
        return {"providers": provs, "llmConfigured": configured}

    async def _candidates(self, tier: str, private_mode: bool) -> list[tuple[Provider, str]]:
        out: list[tuple[Provider, str]] = []
        for entry in self.tiers.get(tier, []):
            pname, _, model = entry.partition("/")
            p = self.providers.get(pname)
            if not p or not p.usable or not model:
                continue
            if private_mode and p.privacy not in PRIVATE_OK:
                continue
            if self._cooldown.get(pname, 0) > time.time():
                continue
            if pname == "ollama" and not await self._ollama_reachable():
                continue
            out.append((p, model))
        return out

    def _headers(self, p: Provider) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if p.api_key:
            h["Authorization"] = f"Bearer {p.api_key}"
        return h

    def _payload(self, model: str, messages: list[dict], *, max_tokens: int, temperature: float, stream: bool, json_mode: bool) -> dict:
        body: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}
        if "gpt-oss" in model:  # reasoning models: keep thinking short and leave token headroom for it
            body["reasoning_effort"] = "low"
            body["max_tokens"] = max_tokens + 400
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        return body

    def _penalize(self, p: Provider, status: int, retry_after: float | None = None) -> None:
        if status == 429:
            self._cooldown[p.name] = time.time() + (retry_after or COOLDOWN_429)
        elif status in (401, 403):
            self._cooldown[p.name] = time.time() + COOLDOWN_AUTH

    async def _no_provider_error(self, tier: str, private_mode: bool) -> LLMError:
        any_usable = any(p.usable for p in self.providers.values() if p.name != "ollama") or await self._ollama_reachable()
        if not any_usable:
            return NotConfigured()
        if private_mode:
            return LLMError("PRIVATE_MODE_NO_PROVIDER", "Private mode is on but no local or no-training provider is available.", retryable=False)
        return LLMError("LLM_UNAVAILABLE", "All AI providers are busy or unavailable right now. Please try again in a minute.", retryable=True)

    # ----- non-streaming -----
    async def complete(self, messages: list[dict], tier: str = "quality", *, max_tokens: int = 1024, temperature: float = 0.2,
                       json_mode: bool = False, private_mode: bool = False) -> LLMResult:
        cands = await self._candidates(tier, private_mode)
        if not cands:
            raise await self._no_provider_error(tier, private_mode)
        last_err = "unknown"
        for p, model in cands:
            use_json = json_mode
            for attempt in range(2):
                t0 = time.time()
                try:
                    r = await self.client.post(p.base_url + "/chat/completions", headers=self._headers(p),
                                               json=self._payload(model, messages, max_tokens=max_tokens, temperature=temperature, stream=False, json_mode=use_json))
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    last_err = f"{p.name}: {type(e).__name__}"
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                if r.status_code == 200:
                    data = r.json()
                    choice = (data.get("choices") or [{}])[0]
                    text = (choice.get("message") or {}).get("content") or ""
                    usage = data.get("usage") or {}
                    return LLMResult(text=text, model=f"{p.name}/{model}",
                                     tokens_in=int(usage.get("prompt_tokens") or sum(est_tokens(m["content"]) for m in messages)),
                                     tokens_out=int(usage.get("completion_tokens") or est_tokens(text)),
                                     latency_ms=int((time.time() - t0) * 1000))
                last_err = f"{p.name}: HTTP {r.status_code}"
                if r.status_code == 400 and use_json:
                    use_json = False  # model/provider may not support response_format
                    continue
                if r.status_code in (429, 401, 403):
                    ra = r.headers.get("retry-after")
                    self._penalize(p, r.status_code, float(ra) if ra and ra.replace(".", "", 1).isdigit() else None)
                    break
                if r.status_code >= 500:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break
        raise LLMError("LLM_UNAVAILABLE", f"All AI providers failed ({last_err}). Please try again shortly.", retryable=True)

    async def complete_model(self, messages: list[dict], model_cls: Type[T], tier: str = "structured", *, max_tokens: int = 1500,
                             temperature: float = 0.1, private_mode: bool = False) -> tuple[T, LLMResult]:
        """Structured output: JSON mode -> tolerant parse -> Pydantic validation -> one repair attempt."""
        res = await self.complete(messages, tier, max_tokens=max_tokens, temperature=temperature, json_mode=True, private_mode=private_mode)
        try:
            return model_cls.model_validate(extract_json(res.text)), res
        except (ValueError, ValidationError) as e:
            repair = messages + [
                {"role": "assistant", "content": res.text[:3000]},
                {"role": "user", "content": f"Your reply was not valid for the required JSON schema ({str(e)[:400]}). "
                                            "Reply again with ONLY the corrected JSON object, no commentary."},
            ]
            res2 = await self.complete(repair, tier, max_tokens=max_tokens, temperature=0.0, json_mode=True, private_mode=private_mode)
            try:
                out = model_cls.model_validate(extract_json(res2.text))
            except (ValueError, ValidationError) as e2:
                raise LLMError("STRUCTURED_OUTPUT_FAILED", f"Model returned invalid structured output: {str(e2)[:200]}", retryable=True)
            res2.tokens_in += res.tokens_in
            res2.tokens_out += res.tokens_out
            return out, res2

    # ----- streaming -----
    async def stream(self, messages: list[dict], tier: str = "quality", *, max_tokens: int = 1500, temperature: float = 0.3,
                     private_mode: bool = False) -> AsyncIterator[StreamChunk]:
        cands = await self._candidates(tier, private_mode)
        if not cands:
            raise await self._no_provider_error(tier, private_mode)
        last_err = "unknown"
        for p, model in cands:
            emitted = False
            out_text = ""
            try:
                async with self.client.stream("POST", p.base_url + "/chat/completions", headers=self._headers(p),
                                              json=self._payload(model, messages, max_tokens=max_tokens, temperature=temperature, stream=True, json_mode=False)) as r:
                    if r.status_code != 200:
                        await r.aread()
                        last_err = f"{p.name}: HTTP {r.status_code}"
                        ra = r.headers.get("retry-after")
                        self._penalize(p, r.status_code, float(ra) if ra and ra.replace(".", "", 1).isdigit() else None)
                        continue
                    usage_in = usage_out = 0
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except Exception:
                            continue
                        if obj.get("usage"):
                            usage_in = int(obj["usage"].get("prompt_tokens") or 0)
                            usage_out = int(obj["usage"].get("completion_tokens") or 0)
                        for ch in obj.get("choices") or []:
                            delta = (ch.get("delta") or {}).get("content")
                            if delta:
                                emitted = True
                                out_text += delta
                                yield StreamChunk(text=delta)
                    yield StreamChunk(done=True, model=f"{p.name}/{model}",
                                      tokens_in=usage_in or sum(est_tokens(m["content"]) for m in messages),
                                      tokens_out=usage_out or est_tokens(out_text))
                    return
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_err = f"{p.name}: {type(e).__name__}"
                if emitted:  # cannot transparently fall back after partial output
                    raise LLMError("LLM_STREAM_INTERRUPTED", "The AI provider connection dropped mid-answer.", retryable=True)
                continue
        raise LLMError("LLM_UNAVAILABLE", f"All AI providers failed ({last_err}). Please try again shortly.", retryable=True)


_gateway: LLMGateway | None = None


def get_gateway() -> LLMGateway:
    global _gateway
    if _gateway is None:
        _gateway = LLMGateway()
    return _gateway


def set_gateway(g: LLMGateway | None) -> None:
    """Test hook."""
    global _gateway
    _gateway = g
