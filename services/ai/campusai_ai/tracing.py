"""Agent run / step tracing into ai.agent_runs and ai.agent_steps (blueprint 5.6)."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from . import db


def _preview(v: Any, limit: int = 3500) -> Any:
    if v is None:
        return None
    try:
        s = json.dumps(v, default=str, ensure_ascii=False)
    except Exception:
        s = str(v)
    if len(s) > limit:
        return {"truncated": s[:limit]}
    return json.loads(s)


class Tracer:
    def __init__(self, user_id: str, conversation_id: str | None, kind: str = "CHAT", request_id: str = ""):
        self.run_id = str(uuid.uuid4())
        self.user_id = user_id
        self.conversation_id = conversation_id
        self.kind = kind
        self.request_id = request_id
        self._idx = 0
        self._t0 = time.time()
        self.tokens_in = 0
        self.tokens_out = 0
        self._started = False

    async def start(self, route: str | None = None) -> None:
        await db.execute(
            "insert into ai.agent_runs(id, user_id, conversation_id, kind, request_id, route) values ($1,$2,$3,$4,$5,$6)",
            uuid.UUID(self.run_id), uuid.UUID(self.user_id), uuid.UUID(self.conversation_id) if self.conversation_id else None,
            self.kind, self.request_id, route,
        )
        self._started = True

    async def set_route(self, route: str, intents: Any = None, plan: Any = None) -> None:
        await db.execute("update ai.agent_runs set route=$2, intents=$3, plan=$4 where id=$1", uuid.UUID(self.run_id), route,
                         _preview(intents), _preview(plan))

    async def step(self, node: str, type_: str, *, input: Any = None, output: Any = None, model: str | None = None,
                   tokens_in: int = 0, tokens_out: int = 0, latency_ms: int | None = None, status: str = "OK",
                   error: str | None = None, prompt_version: str | None = None) -> None:
        self._idx += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        try:
            await db.execute(
                """insert into ai.agent_steps(run_id, step_index, node, type, input_preview, output_preview, provider_model, prompt_version,
                   tokens_in, tokens_out, latency_ms, status, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                uuid.UUID(self.run_id), self._idx, node, type_, _preview(input), _preview(output), model, prompt_version,
                tokens_in, tokens_out, latency_ms, status, (error or "")[:500] or None,
            )
        except Exception:  # tracing must never break a request
            pass

    async def finish(self, status: str = "SUCCEEDED", error_code: str | None = None) -> None:
        if not self._started:
            return
        try:
            await db.execute(
                "update ai.agent_runs set status=$2, tokens_in=$3, tokens_out=$4, latency_ms=$5, error_code=$6, finished_at=now() where id=$1",
                uuid.UUID(self.run_id), status, self.tokens_in, self.tokens_out, int((time.time() - self._t0) * 1000), error_code,
            )
        except Exception:
            pass

    async def llm_step(self, node: str, res, *, input: Any = None, output: Any = None, prompt_version: str | None = None) -> None:
        await self.step(node, "LLM", input=input, output=output if output is not None else res.text[:1500], model=res.model,
                        tokens_in=res.tokens_in, tokens_out=res.tokens_out, latency_ms=res.latency_ms, prompt_version=prompt_version)
