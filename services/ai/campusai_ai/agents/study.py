"""Study Agent: corrective RAG. Contextualize -> retrieve -> grade -> (rewrite/broaden -> retrieve) -> answer | abstain, then citation verification."""
from __future__ import annotations

import re
import uuid
from typing import AsyncIterator

from .. import db
from ..config import get_settings
from ..embeddings import cosine, get_embedder
from ..errors import AppError
from ..llm.gateway import extract_json, get_gateway
from ..rag.retrieval import Hit, build_context, search_documents, stitch
from . import prompts as P
from .base import Ctx, Event, add_text, history_messages, stream_answer

QUIZ_INTENT = re.compile(r"\b(quiz me|test me|give me (?:a )?quiz|make (?:a )?quiz|generate (?:a )?quiz|create (?:a )?quiz|mcqs?|practice questions|practice quiz)\b", re.I)
EXPLAIN_INTENT = re.compile(r"\b(explain|teach|intuition|walk me through|help me understand|eli5|in detail)\b", re.I)
SUMMARY_INTENT = re.compile(r"\b(summari[sz]e|summary|key points|overview|revision notes|tl;?dr)\b", re.I)
FOLLOWUP_HINT = re.compile(r"\b(it|its|this|that|they|them|those|these|he|she|the same|more|another|above|previous|why|how about|what about)\b", re.I)
CITE = re.compile(r"\[S(\d+)\]")
SUPPORT_THRESHOLD = 0.5


async def _contextualize(ctx: Ctx) -> str:
    if not ctx.history or not (len(ctx.content.split()) < 12 or FOLLOWUP_HINT.search(ctx.content)):
        return ctx.content
    try:
        msgs = [{"role": "system", "content": P.REWRITE_V1}] + history_messages(ctx, 4) + [{"role": "user", "content": ctx.content}]
        res = await get_gateway().complete(msgs, "fast", max_tokens=80, temperature=0.0, private_mode=ctx.private)
        await ctx.tracer.llm_step("contextualize", res, prompt_version="rewrite.v1")
        q = res.text.strip().strip('"')
        return q if 3 <= len(q) <= 300 else ctx.content
    except AppError:
        return ctx.content


async def _scope_docs(ctx: Ctx) -> tuple[list[str] | None, str | None, int]:
    docs = [str(d) for d in ctx.scope.get("documentIds") or []]
    subject = ctx.scope.get("subjectId")
    ready = await db.fetchval(
        "select count(*) from app.documents where user_id=$1 and purpose='STUDY' and status='READY'"
        + (" and id = any($2)" if docs else (" and subject_id=$2" if subject else "")),
        *([uuid.UUID(ctx.user_id)] + ([[uuid.UUID(d) for d in docs]] if docs else ([uuid.UUID(subject)] if subject else []))))
    return (docs or None), subject, int(ready or 0)


async def _grade(ctx: Ctx, query: str, hits: list[Hit]) -> bool:
    s = get_settings()
    if not hits:
        return False
    best = max(h.dense for h in hits)
    if best >= s.sufficient_score:
        return True
    if best < s.insufficient_score:
        return False
    try:  # ambiguous band: ask a fast model
        ctx_text, _ = build_context(hits[:4], 6000)
        msgs = [{"role": "system", "content": P.GRADER_V1}, {"role": "user", "content": f"QUESTION: {query}\n\nPASSAGES:\n{ctx_text}"}]
        res = await get_gateway().complete(msgs, "fast", max_tokens=30, temperature=0.0, json_mode=True, private_mode=ctx.private)
        await ctx.tracer.llm_step("grade", res, prompt_version="grader.v1")
        return bool(extract_json(res.text).get("sufficient"))
    except (AppError, ValueError, AttributeError):
        return best >= 0.5


async def _quiz_action(ctx: Ctx, docs, subject) -> AsyncIterator[Event]:
    topic = re.sub(QUIZ_INTENT, "", ctx.content).strip(" ?.!,:-") or ""
    topic = re.sub(r"^(on|about|from|for|of)\s+", "", topic, flags=re.I)
    hits = await search_documents(ctx.user_id, topic or "key concepts", document_ids=docs, subject_id=subject, top_k=6) if topic else []
    topic_ids, doc_ids, titles = [], [], []
    for h in hits:
        if h.dense >= 0.45:
            if h.topic_id and h.topic_id not in topic_ids:
                topic_ids.append(h.topic_id)
            if h.document_id not in doc_ids:
                doc_ids.append(h.document_id)
    if not doc_ids:
        rows = await db.fetch("select id, title from app.documents where user_id=$1 and purpose='STUDY' and status='READY' "
                              + ("and id = any($2) " if docs else "") + "order by created_at desc limit 1",
                              *([uuid.UUID(ctx.user_id)] + ([[uuid.UUID(d) for d in docs]] if docs else [])))
        doc_ids = [str(r["id"]) for r in rows]
    if topic_ids:
        trows = await db.fetch("select title from app.topics where id = any($1)", [uuid.UUID(t) for t in topic_ids[:5]])
        titles = [r["title"] for r in trows]
    yield Event("tool_call", {"tool": "plan_quiz", "args": {"topic": topic}})
    if not doc_ids:
        for e in add_text(ctx, "I couldn't find study material to build a quiz from. Upload documents in the Study library first."):
            yield e
        return
    ctx.actions.append({"type": "create_quiz", "documentIds": doc_ids, "topicIds": topic_ids[:5], "title": f"Quiz: {topic}"[:80] if topic else "Practice quiz",
                        "numQuestions": 8, "difficulty": "ADAPTIVE"})
    yield Event("tool_result", {"tool": "plan_quiz", "summary": f"{len(topic_ids)} matching topics" if topic_ids else "using your latest document"})
    msg = ("I've prepared an adaptive quiz" + (f" on **{', '.join(titles)}**" if titles else "") +
           " from your own materials. Click **Generate quiz** below to create it - questions target your weaker topics first.")
    for e in add_text(ctx, msg):
        yield e


async def run(ctx: Ctx) -> AsyncIterator[Event]:
    s = get_settings()
    ctx.agent = "study"
    docs, subject, ready = await _scope_docs(ctx)
    if ready == 0:
        for e in add_text(ctx, "I can't search any study materials yet — "
                               + ("the selected documents are still processing or failed to process. " if docs or subject else "you haven't uploaded any documents. ")
                               + "Upload PDFs or notes in **Study → Library** and wait until they show *Ready*."):
            yield e
        ctx.grounded = None
        return
    if QUIZ_INTENT.search(ctx.content):
        async for e in _quiz_action(ctx, docs, subject):
            yield e
        return

    yield Event("status", {"text": "Understanding your question…"})
    query = await _contextualize(ctx)
    summarize = bool(SUMMARY_INTENT.search(ctx.content))
    top_k = 10 if summarize else 7

    async def retrieve(q: str, d, sub) -> list[Hit]:
        yield_args = {"query": q[:120], "scope": f"{len(d)} document(s)" if d else ("subject" if sub else "all documents")}
        hits = await search_documents(ctx.user_id, q, document_ids=d, subject_id=sub, top_k=top_k)
        await ctx.tracer.step("search_documents", "TOOL", input=yield_args, output={"hits": len(hits), "best_dense": round(max([h.dense for h in hits] or [0]), 3),
                                                                                    "pages": [f"{h.title}:{h.page_start}" for h in hits[:5]]})
        return hits

    yield Event("status", {"text": "Searching your documents…"})
    yield Event("tool_call", {"tool": "search_documents", "args": {"query": query[:120]}})
    hits = await retrieve(query, docs, subject)
    ndocs = len({h.document_id for h in hits})
    yield Event("tool_result", {"tool": "search_documents", "summary": f"{len(hits)} passages from {ndocs} document(s)"})
    ok = await _grade(ctx, query, hits)
    rewrites = 0
    while not ok and rewrites < s.max_rewrites:
        rewrites += 1
        yield Event("status", {"text": "Not enough relevant material — rewriting the search…"})
        q2 = query
        try:
            msgs = [{"role": "system", "content": P.REWRITE_V1}] + history_messages(ctx, 4) + [{"role": "user", "content": f"Previous query was too narrow: {query}\nOriginal question: {ctx.content}"}]
            res = await get_gateway().complete(msgs, "fast", max_tokens=80, temperature=0.3, private_mode=ctx.private)
            await ctx.tracer.llm_step("rewrite_query", res, prompt_version="rewrite.v1")
            q2 = res.text.strip().strip('"') or query
        except AppError:
            q2 = " ".join(re.findall(r"[A-Za-z0-9]+", ctx.content)[:12])
        yield Event("tool_call", {"tool": "search_documents", "args": {"query": q2[:120], "scope": "broadened"}})
        hits2 = await retrieve(q2, None, None)  # broaden to all of the student's documents
        yield Event("tool_result", {"tool": "search_documents", "summary": f"{len(hits2)} passages from {len({h.document_id for h in hits2})} document(s)"})
        merged = {h.id: h for h in hits + hits2}
        hits = sorted(merged.values(), key=lambda h: -h.dense)[:top_k]
        query = q2
        ok = await _grade(ctx, q2, hits)

    if not ok:
        ctx.grounded = False
        for e in add_text(ctx, "I couldn't find this in your selected study materials.\n\n"):
            yield e
        try:
            msgs = [{"role": "system", "content": P.GENERAL_KNOWLEDGE_V1}] + history_messages(ctx, 2) + [{"role": "user", "content": ctx.content}]
            async for e in stream_answer(ctx, msgs, tier="fast", node="general_knowledge_fallback", max_tokens=400, prompt_version="general_knowledge.v1"):
                yield e
        except AppError:
            pass
        await ctx.tracer.step("abstain", "ROUTE", output={"reason": "retrieval insufficient", "rewrites": rewrites})
        return

    stitched = stitch(hits)
    context_text, used = build_context(stitched)
    mode = P.MODE_SUMMARIZE if summarize else (P.MODE_EXPLAIN if EXPLAIN_INTENT.search(ctx.content) else P.MODE_QA)
    system = P.STUDY_ANSWER_V3.format(mode_instructions=mode, profile=ctx.profile)
    msgs = [{"role": "system", "content": system}] + history_messages(ctx, 4) + [
        {"role": "user", "content": f"SOURCES:\n{context_text}\n\nQUESTION: {ctx.content}"}]
    yield Event("status", {"text": "Writing the answer…"})
    async for e in stream_answer(ctx, msgs, tier="quality", node="study_answer", prompt_version="study_answer.v3"):
        yield e

    # ---- citation parsing + support check ----
    cited_ids = sorted({int(m) for m in CITE.findall(ctx.answer) if 1 <= int(m) <= len(used)})
    uncited = not cited_ids
    shown_ids = cited_ids or list(range(1, min(3, len(used)) + 1))  # model forgot to cite: show consulted sources, flagged below
    ctx.citations = [{
        "id": f"S{i}", "type": "document", "documentId": used[i - 1].document_id, "title": used[i - 1].title,
        "pageStart": used[i - 1].page_start, "pageEnd": used[i - 1].page_end, "section": used[i - 1].section_path,
        "snippet": used[i - 1].content[:240], "score": round(used[i - 1].dense, 3), "consultedOnly": uncited,
    } for i in shown_ids]
    ctx.grounded = False if uncited else await _support_check(ctx, used, True)
    await ctx.tracer.step("citation_check", "ROUTE", output={"cited": cited_ids, "consulted_only": uncited, "grounded": ctx.grounded})


async def _support_check(ctx: Ctx, used: list[Hit], has_citations: bool) -> bool:
    if not has_citations:
        return False
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+|\n+", ctx.answer) if CITE.search(x)]
    if not sentences:
        return False
    emb = get_embedder()
    sent_vecs = await emb.embed_plain([CITE.sub("", x)[:400] for x in sentences])
    chunk_vecs = await emb.embed_plain([h.content[:1500] for h in used])
    weak = 0
    for sent, sv in zip(sentences, sent_vecs):
        ids = [int(m) for m in CITE.findall(sent) if 1 <= int(m) <= len(used)]
        best = max((cosine(sv, chunk_vecs[i - 1]) for i in ids), default=0.0)
        if best < SUPPORT_THRESHOLD:
            weak += 1
    return weak / len(sentences) <= 0.3
