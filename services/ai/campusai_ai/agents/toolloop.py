"""Generic bounded tool-using agent loop with a JSON action protocol (works with any model, including small local ones)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable

from ..errors import AppError
from ..llm.gateway import extract_json, get_gateway
from . import prompts as P
from .base import Ctx, Event

MAX_OBS_CHARS = 3200


@dataclass
class Tool:
    name: str
    description: str
    args: str
    fn: Callable[..., Awaitable[Any]]


@dataclass
class Observation:
    tool: str
    args: dict
    result: str


def render_tools(tools: dict[str, Tool]) -> str:
    return "\n".join(f"- {t.name}({t.args}): {t.description}" for t in tools.values())


def _fmt(result: Any) -> str:
    s = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
    return s if len(s) <= MAX_OBS_CHARS else s[:MAX_OBS_CHARS] + " …[truncated]"


async def run_tools(ctx: Ctx, name: str, tools: dict[str, Tool], extra_system: str, observations: list[Observation],
                    preamble: str = "") -> AsyncIterator[Event]:
    """Loops: LLM picks an action -> tool executes -> observation appended. Ends on 'final' or budget exhaustion."""
    system = P.TOOL_AGENT_SYSTEM.format(name=name, max_calls=ctx.max_tool_calls, tools=render_tools(tools), extra=extra_system)
    seen: set[str] = set()
    for step in range(ctx.max_tool_calls + 1):
        convo = []
        for h in ctx.history[-4:]:
            convo.append({"role": h["role"], "content": h["content"][:1200]})
        obs_text = "\n\n".join(f"[{i + 1}] {o.tool}({json.dumps(o.args, default=str)}) ->\n{o.result}" for i, o in enumerate(observations)) or "(none yet)"
        user = f"{preamble}\nSTUDENT REQUEST: {ctx.content}\n\nOBSERVATIONS SO FAR:\n{obs_text}\n\nCalls used: {len(observations)}/{ctx.max_tool_calls}. Reply with the next JSON action."
        t0 = time.time()
        res = await get_gateway().complete([{"role": "system", "content": system}] + convo + [{"role": "user", "content": user}],
                                           "structured", max_tokens=400, temperature=0.0, json_mode=True, private_mode=ctx.private)
        try:
            act = extract_json(res.text)
            action = str(act.get("action", "final"))
            args = act.get("args") or {}
            thought = str(act.get("thought", ""))[:300]
        except (ValueError, AttributeError):
            action, args, thought = "final", {}, "unparseable action; finishing"
        await ctx.tracer.step(f"{name}.decide", "LLM", input={"step": step + 1}, output={"action": action, "args": args, "thought": thought}, model=res.model,
                              tokens_in=res.tokens_in, tokens_out=res.tokens_out, latency_ms=res.latency_ms, prompt_version="tool_agent.v1")
        if action == "final" or action not in tools or len(observations) >= ctx.max_tool_calls:
            return
        key = action + json.dumps(args, sort_keys=True, default=str)
        if key in seen:  # identical repeat call -> stop looping
            return
        seen.add(key)
        yield Event("tool_call", {"tool": action, "args": args})
        t1 = time.time()
        try:
            out = await tools[action].fn(**args) if isinstance(args, dict) else await tools[action].fn()
            status, err = "OK", None
        except TypeError as e:
            out, status, err = {"error": f"bad arguments: {e}"}, "ERROR", str(e)
        except AppError as e:
            out, status, err = {"error": e.message}, "ERROR", e.message
        text = _fmt(out)
        observations.append(Observation(action, args if isinstance(args, dict) else {}, text))
        await ctx.tracer.step(action, "TOOL", input=args, output=text[:1500], latency_ms=int((time.time() - t1) * 1000), status=status, error=err)
        yield Event("tool_result", {"tool": action, "summary": _summary(out)})


def _summary(out: Any) -> str:
    if isinstance(out, dict):
        if "error" in out:
            return "error: " + str(out["error"])[:100]
        for k in ("results", "matches", "files", "frames", "definitions", "entries", "items", "jobDescriptions"):
            if k in out and isinstance(out[k], list):
                return f"{len(out[k])} {k}"
        return ", ".join(f"{k}" for k in list(out.keys())[:4])
    if isinstance(out, list):
        return f"{len(out)} items"
    return str(out)[:80]


def observations_block(observations: list[Observation]) -> str:
    return "\n\n".join(f"### {o.tool}({json.dumps(o.args, default=str)})\n{o.result}" for o in observations) or "(no tools were called)"
