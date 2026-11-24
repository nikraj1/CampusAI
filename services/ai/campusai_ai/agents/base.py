"""Shared agent types, SSE events and streaming helper."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from ..auth import Principal
from ..llm.gateway import get_gateway
from ..tracing import Tracer


@dataclass
class Event:
    name: str
    data: dict = field(default_factory=dict)

    def sse(self) -> str:
        return f"event: {self.name}\ndata: {json.dumps(self.data, ensure_ascii=False, default=str)}\n\n"


@dataclass
class Ctx:
    principal: Principal
    tracer: Tracer
    content: str
    conversation_id: str | None = None
    module: str = "GENERAL"
    scope: dict = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)  # [{"role": "user"|"assistant", "content": str}]
    profile: str = ""
    # outputs
    answer: str = ""
    citations: list[dict] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)
    grounded: bool | None = None
    agent: str = ""
    max_tool_calls: int = 6

    @property
    def user_id(self) -> str:
        return self.principal.user_id

    @property
    def private(self) -> bool:
        return self.principal.private_mode

    def fork(self, content: str | None = None) -> "Ctx":
        c = Ctx(self.principal, self.tracer, content if content is not None else self.content, self.conversation_id, self.module, dict(self.scope),
                list(self.history), self.profile)
        return c


def history_messages(ctx: Ctx, limit: int = 6) -> list[dict]:
    return [{"role": m["role"], "content": m["content"][:1500]} for m in ctx.history[-limit:]]


async def stream_answer(ctx: Ctx, messages: list[dict], *, tier: str = "quality", node: str = "answer", max_tokens: int = 1400,
                        prompt_version: str = "v1", emit: bool = True) -> AsyncIterator[Event]:
    """Streams an LLM answer as token events, appending to ctx.answer, and traces the step."""
    t0 = time.time()
    model, tin, tout = "", 0, 0
    start_len = len(ctx.answer)
    async for ch in get_gateway().stream(messages, tier, max_tokens=max_tokens, private_mode=ctx.private):
        if ch.done:
            model, tin, tout = ch.model, ch.tokens_in, ch.tokens_out
        elif ch.text:
            ctx.answer += ch.text
            if emit:
                yield Event("token", {"t": ch.text})
    await ctx.tracer.step(node, "LLM", input={"messages": len(messages), "tier": tier}, output=ctx.answer[start_len:][:1500], model=model,
                          tokens_in=tin, tokens_out=tout, latency_ms=int((time.time() - t0) * 1000), prompt_version=prompt_version)


def add_text(ctx: Ctx, text: str, emit: bool = True) -> list[Event]:
    ctx.answer += text
    return [Event("token", {"t": text})] if emit else []
