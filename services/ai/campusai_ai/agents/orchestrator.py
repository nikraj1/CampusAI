"""Orchestrator: guard -> route (module hint or intent classifier) -> single agent | bounded multi-step plan -> synthesis (blueprint 6.3)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import AsyncIterator

from pydantic import BaseModel, Field

from .. import db
from ..auth import Principal
from ..config import get_settings
from ..errors import AppError
from ..llm.gateway import get_gateway
from ..tracing import Tracer
from . import career, project, study
from . import prompts as P
from .base import Ctx, Event, history_messages, stream_answer

log = logging.getLogger("campusai.orchestrator")
INJECTION = re.compile(r"(ignore (?:all |any )?(?:previous|prior|above) instructions|system prompt|you are now|disregard .* instructions|reveal your (?:prompt|instructions))", re.I)
AGENTS = {"study": study, "career": career, "project": project}
MAX_PLAN_STEPS = 3


class IntentItem(BaseModel):
    module: str = "general"
    task: str = ""
    confidence: float = 0.5


class Classification(BaseModel):
    intents: list[IntentItem] = Field(default_factory=list)
    needs_plan: bool = False
    clarification_question: str | None = None


def heuristic_route(text: str) -> Classification:
    t = text.lower()
    scores = {
        "career": len(re.findall(r"\b(resume|cv|job description|jd|interview|placement|internship|career|roadmap|skill gap|hiring|recruiter|offer letter)\b", t)),
        "project": len(re.findall(r"\b(repo|repository|codebase|code|bug|stack ?trace|exception|error|function|class|method|api|endpoint|refactor|github|compile|null ?pointer|traceback)\b", t)),
        "study": len(re.findall(r"\b(notes?|chapter|pdf|document|lecture|quiz|mcq|explain|summari[sz]e|syllabus|topic|textbook|exam|concept|define)\b", t)),
    }
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return Classification(intents=[IntentItem(module="general", task="chitchat", confidence=0.5)])
    intents = [IntentItem(module=best, task="auto", confidence=0.65)]
    others = [m for m, s in scores.items() if m != best and s > 0 and s >= scores[best] - 1]
    if others and len(t.split()) > 12:
        intents.append(IntentItem(module=others[0], task="auto", confidence=0.6))
    return Classification(intents=intents, needs_plan=len(intents) > 1)


async def student_context(user_id: str) -> str:
    uid = uuid.UUID(user_id)
    docs = await db.fetchval("select count(*) from app.documents where user_id=$1 and purpose='STUDY' and status='READY'", uid)
    repos = await db.fetchval("select count(*) from app.repositories where user_id=$1 and index_status='READY'", uid)
    resumes = await db.fetchval("select count(*) from app.resumes where user_id=$1 and parse_status='PARSED'", uid)
    jds = await db.fetchval("select count(*) from app.job_descriptions where user_id=$1", uid)
    return f"study documents={docs}, indexed repositories={repos}, parsed resumes={resumes}, saved job descriptions={jds}"


async def profile_snapshot(user_id: str) -> str:
    p = await db.fetchrow("select degree, branch, graduation_year, target_role, experience_level, preferences from app.user_profiles where user_id=$1", uuid.UUID(user_id))
    if not p:
        return ""
    bits = [f"{k}: {v}" for k, v in (("degree", p["degree"]), ("branch", p["branch"]), ("graduation year", p["graduation_year"]), ("target role", p["target_role"])) if v]
    style = (p["preferences"] or {}).get("answerStyle")
    if style:
        bits.append(f"preferred answer style: {style}")
    return "STUDENT PROFILE: " + "; ".join(bits) if bits else ""


async def classify(ctx: Ctx) -> Classification:
    try:
        sysmsg = P.CLASSIFIER_V2.replace("{context}", await student_context(ctx.user_id))
        msgs = [{"role": "system", "content": sysmsg}] + history_messages(ctx, 2) + [{"role": "user", "content": ctx.content}]
        c, res = await get_gateway().complete_model(msgs, Classification, "fast", max_tokens=300, temperature=0.0, private_mode=ctx.private)
        c.intents = [i for i in c.intents if i.module in ("study", "career", "project", "general")]
        await ctx.tracer.llm_step("classifier", res, output=c.model_dump(), prompt_version="classifier.v2")
        if not c.intents:
            raise AppError("EMPTY_CLASSIFICATION", "no intents")
        return c
    except AppError as e:
        h = heuristic_route(ctx.content)
        await ctx.tracer.step("classifier", "ROUTE", output={"fallback": "heuristic", "reason": e.code, **h.model_dump()}, status="FALLBACK")
        return h


def validate_plan(c: Classification) -> list[IntentItem]:
    """Code-validated plan: only known agents, one step per agent, max 3 steps."""
    seen, steps = set(), []
    for i in c.intents:
        if i.module in AGENTS and i.module not in seen and i.confidence >= 0.5:
            seen.add(i.module)
            steps.append(i)
    return steps[:MAX_PLAN_STEPS]


async def general_responder(ctx: Ctx) -> AsyncIterator[Event]:
    ctx.agent = "general"
    msgs = [{"role": "system", "content": P.GENERAL_V1.format(profile=ctx.profile)}] + history_messages(ctx, 6) + [{"role": "user", "content": ctx.content}]
    async for e in stream_answer(ctx, msgs, tier="fast", node="general_responder", max_tokens=700, prompt_version="general.v1"):
        yield e


async def run_single(ctx: Ctx, module: str) -> AsyncIterator[Event]:
    async for e in AGENTS[module].run(ctx):
        yield e


async def run_plan(ctx: Ctx, steps: list[IntentItem]) -> AsyncIterator[Event]:
    results = []
    for n, step in enumerate(steps, 1):
        yield Event("status", {"text": f"Step {n}/{len(steps)}: {step.module} agent…"})
        sub = ctx.fork()
        if step.module == "study" and any(s.task == "quiz" for s in steps if s.module == "study"):
            sub.content = ctx.content  # quiz intent detected by the study agent itself
        sub.module = step.module.upper()
        async for e in AGENTS[step.module].run(sub):
            if e.name in ("status", "tool_call", "tool_result"):
                yield e
        results.append((step.module, sub))
        ctx.actions += sub.actions
        ctx.citations += sub.citations
    body = "\n\n".join(f"### Result from {m} agent\n{s.answer}" for m, s in results)
    msgs = [{"role": "system", "content": P.SYNTH_V1}, {"role": "user", "content": f"STUDENT REQUEST: {ctx.content}\n\nPARTIAL RESULTS:\n{body}"}]
    ctx.agent = "+".join(m for m, _ in results)
    yield Event("status", {"text": "Combining the results…"})
    async for e in stream_answer(ctx, msgs, tier="quality", node="synthesizer", prompt_version="synth.v1"):
        yield e
    groundeds = [s.grounded for _, s in results if s.grounded is not None]
    ctx.grounded = all(groundeds) if groundeds else None


async def load_history(conversation_id: str, user_id: str, exclude_message_ids: set[str]) -> list[dict]:
    rows = await db.fetch(
        """select m.id, m.role, m.content from app.messages m join app.conversations c on c.id=m.conversation_id
           where m.conversation_id=$1 and c.user_id=$2 and m.status in ('COMPLETE','INCOMPLETE') and m.content <> '' order by m.created_at desc limit 12""",
        uuid.UUID(conversation_id), uuid.UUID(user_id))
    out = [{"role": "user" if r["role"] == "USER" else "assistant", "content": r["content"]} for r in reversed(rows) if str(r["id"]) not in exclude_message_ids]
    return out[-8:]


async def check_budget(user_id: str) -> None:
    used = await db.fetchval("select coalesce(sum(tokens_in+tokens_out),0) from ai.agent_runs where user_id=$1 and started_at > now() - interval '1 day'", uuid.UUID(user_id))
    if int(used or 0) > get_settings().per_user_daily_tokens:
        raise AppError("TOKEN_BUDGET_EXCEEDED", "You've reached today's AI usage limit. It resets within 24 hours.", retryable=False, status=429)


async def run_chat(principal: Principal, req: dict) -> AsyncIterator[Event]:
    conv_id = req["conversationId"]
    conv = await db.fetchrow("select module, scope from app.conversations where id=$1 and user_id=$2", uuid.UUID(conv_id), uuid.UUID(principal.user_id))
    tracer = Tracer(principal.user_id, conv_id, "CHAT", principal.request_id)
    if not conv:
        yield Event("error", {"code": "NOT_FOUND", "message": "Conversation not found", "retryable": False})
        return
    await tracer.start()
    ctx = Ctx(principal, tracer, req["content"], conv_id, conv["module"], req.get("scope") or conv["scope"] or {})
    status = "SUCCEEDED"
    err_code = None
    try:
        await check_budget(principal.user_id)
        ctx.history = await load_history(conv_id, principal.user_id, {req.get("userMessageId", ""), req.get("assistantMessageId", "")})
        ctx.profile = await profile_snapshot(principal.user_id)
        if len(ctx.content) > 8000:
            raise AppError("MESSAGE_TOO_LONG", "Message is too long.")
        if INJECTION.search(ctx.content):
            await tracer.step("guard", "GUARD", output={"flag": "possible_prompt_injection_pattern"})
        module = (conv["module"] or "GENERAL").lower()
        route = module
        plan_steps: list[IntentItem] = []
        if module == "general":
            c = await classify(ctx)
            steps = validate_plan(c)
            top = max(c.intents, key=lambda i: i.confidence)
            if c.clarification_question and top.confidence < 0.55:
                route = "clarify"
            elif c.needs_plan and len(steps) >= 2:
                route, plan_steps = "plan", steps
            elif top.module in AGENTS and top.confidence >= 0.5:
                route = top.module
            else:
                route = "general"
            await tracer.set_route(route, [i.model_dump() for i in c.intents], [s.model_dump() for s in plan_steps] or None)
            if route == "clarify":
                ctx.agent = "general"
                ctx.answer = c.clarification_question or "Could you tell me a bit more about what you need?"
                yield Event("run_started", {"runId": tracer.run_id, "agent": "general"})
                yield Event("token", {"t": ctx.answer})
        else:
            await tracer.set_route(route)
        if route != "clarify":
            yield Event("run_started", {"runId": tracer.run_id, "agent": route if route != "plan" else "plan"})
            if route == "plan":
                gen = run_plan(ctx, plan_steps)
            elif route in AGENTS:
                gen = run_single(ctx, route)
            else:
                gen = general_responder(ctx)
            async for e in gen:
                yield e
        if ctx.citations:
            yield Event("citations", {"citations": ctx.citations})
        for a in ctx.actions:
            yield Event("action", a)
        if ctx.private is False and ctx.answer.strip() == "":
            ctx.answer = "I couldn't produce an answer. Please try rephrasing."
            yield Event("token", {"t": ctx.answer})
        yield Event("done", {"runId": tracer.run_id, "agent": ctx.agent or route, "grounded": ctx.grounded, "route": route,
                             "usage": {"in": tracer.tokens_in, "out": tracer.tokens_out}})
    except AppError as e:
        status, err_code = "FAILED", e.code
        await tracer.step("error", "GUARD", output=e.to_dict(), status="ERROR", error=e.message)
        yield Event("error", e.to_dict())
    except Exception as e:  # noqa: BLE001
        status, err_code = "FAILED", "INTERNAL_ERROR"
        log.exception("chat run failed")
        yield Event("error", {"code": "INTERNAL_ERROR", "message": "Unexpected error while answering.", "retryable": True})
    finally:
        if status == "SUCCEEDED" and ctx.grounded is False and ctx.agent == "study":
            status = "ABSTAINED"
        await tracer.finish(status, err_code)
