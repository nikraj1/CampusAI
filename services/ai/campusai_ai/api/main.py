"""FastAPI AI service: internal API for the Spring backend (blueprint 8.12)."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .. import db
from ..agents import orchestrator
from ..auth import Principal, require_principal
from ..config import get_settings
from ..embeddings import get_embedder
from ..errors import AppError
from ..llm.gateway import get_gateway
from ..workflows import career as career_wf
from ..workflows import docs as docs_wf
from ..workflows import study as study_wf

log = logging.getLogger("campusai.api")
_worker_task: asyncio.Task | None = None
_stop = asyncio.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker_task
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    await db.get_pool()
    asyncio.get_running_loop().run_in_executor(None, get_embedder().warm_up)  # load model without blocking startup
    if get_settings().worker_embedded:
        from ..worker import run_forever

        _stop.clear()
        _worker_task = asyncio.create_task(run_forever(_stop))
        _worker_task.add_done_callback(lambda t: (not t.cancelled()) and t.exception() and log.error("embedded worker crashed: %r", t.exception()))
        log.info("embedded ingestion worker started")
    yield
    _stop.set()
    if _worker_task:
        _worker_task.cancel()
    await db.close_pool()


app = FastAPI(title="CampusAI AI Service", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url="/internal/openapi.json")


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.to_dict()})


@app.get("/internal/health")
async def health() -> dict:
    h = await get_gateway().health()
    try:
        await db.fetchval("select 1")
        dbok = "ok"
    except Exception:  # noqa: BLE001
        dbok = "down"
    return {"status": "UP" if dbok == "ok" else "DEGRADED", "db": dbok, "embedder": "loaded" if get_embedder()._model else "loading", **h}


# ---------- chat ----------
class ChatReq(BaseModel):
    conversationId: str
    userMessageId: str | None = None
    assistantMessageId: str | None = None
    module: str = "GENERAL"
    scope: dict = {}
    content: str


@app.post("/internal/v1/chat/stream")
async def chat_stream(req: ChatReq, p: Principal = Depends(require_principal)):
    async def gen():
        try:
            async for ev in orchestrator.run_chat(p, req.model_dump()):
                yield ev.sse()
        except asyncio.CancelledError:
            raise
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- study ----------
class SummaryReq(BaseModel):
    topicId: str | None = None
    documentId: str | None = None
    length: str = "SHORT"


@app.post("/internal/v1/study/summaries")
async def summaries(req: SummaryReq, p: Principal = Depends(require_principal)):
    return await study_wf.summarize(p.user_id, req.topicId, req.documentId, req.length.upper())


@app.post("/internal/v1/study/quizzes")
async def quizzes(req: dict, p: Principal = Depends(require_principal)):
    from ..tracing import Tracer
    t = Tracer(p.user_id, None, "TASK", p.request_id)
    await t.start("quiz")
    try:
        out = await study_wf.generate_quiz(p.user_id, req)
        await t.step("generate_quiz", "TOOL", input={"n": req.get("numQuestions"), "difficulty": req.get("difficulty")}, output={"questions": len(out["questions"]), "rejected": out["rejectedCount"]})
        await t.finish("SUCCEEDED")
        return out
    except Exception as e:  # noqa: BLE001
        await t.finish("FAILED", getattr(e, "code", "ERROR"))
        raise


# ---------- career ----------
@app.post("/internal/v1/career/jd/parse")
async def jd_parse(req: dict, p: Principal = Depends(require_principal)):
    return {"parsed": await career_wf.parse_jd(p.user_id, str(req.get("rawText", "")))}


@app.post("/internal/v1/career/analyses")
async def analyses(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.analyze(p.user_id, req["resumeId"], req.get("jobDescriptionId"))


@app.post("/internal/v1/career/roadmaps")
async def roadmaps(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.roadmap(p.user_id, req["targetRole"], req.get("analysisId"), int(req.get("durationWeeks", 8)), int(req.get("hoursPerWeek", 10)))


@app.post("/internal/v1/career/interview-questions")
async def interview_questions(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.question_bank(p.user_id, req)


@app.post("/internal/v1/career/interviews/plan")
async def interview_plan(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.interview_plan(p.user_id, req["sessionId"])


@app.post("/internal/v1/career/interviews/evaluate")
async def interview_evaluate(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.interview_evaluate(p.user_id, req["sessionId"], req["questionId"])


@app.post("/internal/v1/career/interviews/report")
async def interview_report(req: dict, p: Principal = Depends(require_principal)):
    return await career_wf.interview_report(p.user_id, req["sessionId"])


# ---------- project ----------
@app.post("/internal/v1/projects/docs")
async def project_docs(req: dict, p: Principal = Depends(require_principal)):
    return await docs_wf.generate_docs(p.user_id, req["repositoryId"], str(req.get("type", "README")).upper())
