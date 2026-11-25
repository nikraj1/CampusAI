"""AI_INGEST job worker: Postgres queue claimed with FOR UPDATE SKIP LOCKED, woken by LISTEN/NOTIFY (blueprint 5.5)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Awaitable, Callable

from . import db
from .config import get_settings
from .errors import AppError

log = logging.getLogger("campusai.worker")

CLAIM_SQL = """
update app.jobs set status='RUNNING', locked_by=$1, locked_at=now(), attempts=attempts+1, updated_at=now()
where id = (select id from app.jobs where queue='AI_INGEST' and status='QUEUED' and run_after <= now()
            order by priority, created_at for update skip locked limit 1)
returning id, user_id, type, resource_type, resource_id, payload, attempts, max_attempts
"""

REAP_INTERVAL_SECONDS = 300

Handler = Callable[[dict], Awaitable[dict]]


def handlers() -> dict[str, Handler]:
    from .ingestion.documents import ingest_document
    from .ingestion.repo import index_repository
    from .ingestion.resume import parse_resume

    return {"INGEST_DOCUMENT": ingest_document, "PARSE_RESUME": parse_resume, "INDEX_REPOSITORY": index_repository}


async def process_one(worker_id: str) -> bool:
    row = await db.fetchrow(CLAIM_SQL, worker_id)
    if not row:
        return False
    job = dict(row)
    job["payload"] = job["payload"] if isinstance(job["payload"], dict) else json.loads(job["payload"] or "{}")
    jtype = job["type"]
    log.info("claimed job %s (%s) attempt %s", job["id"], jtype, job["attempts"])
    h = handlers().get(jtype)
    try:
        if h is None:
            raise AppError("UNKNOWN_JOB", f"Unknown job type {jtype}")
        result = await h(job)
        await db.execute("update app.jobs set status='SUCCEEDED', progress=100, stage='DONE', result=$2, updated_at=now() where id=$1", job["id"], result or {})
        log.info("job %s succeeded", job["id"])
    except Exception as e:  # noqa: BLE001
        permanent = isinstance(e, AppError) and not e.retryable
        msg = (getattr(e, "message", None) or str(e) or type(e).__name__)[:900]
        log.warning("job %s failed: %s", job["id"], msg, exc_info=not isinstance(e, AppError))
        if permanent or job["attempts"] >= job["max_attempts"]:
            await db.execute("update app.jobs set status='FAILED', error_message=$2, updated_at=now() where id=$1", job["id"], msg)
        else:
            backoff = [30, 120, 600][min(job["attempts"] - 1, 2)]
            await db.execute(
                "update app.jobs set status='QUEUED', error_message=$2, run_after=now() + ($3 || ' seconds')::interval, updated_at=now() where id=$1",
                job["id"],
                msg,
                str(backoff),
            )
    return True


async def reap_stuck() -> None:
    n = await db.execute("update app.jobs set status='QUEUED', updated_at=now() where queue='AI_INGEST' and status='RUNNING' and locked_at < now() - interval '15 minutes'")
    log.info("reaper: %s", n)


async def run_forever(stop: asyncio.Event | None = None) -> None:
    import asyncpg

    s = get_settings()
    wake = asyncio.Event()
    await db.get_pool()
    listener = None

    def _on_notify(*_args):
        wake.set()

    try:  # LISTEN/NOTIFY is an optimisation; polling every 5s is the fallback
        listener = await asyncpg.connect(s.db_dsn)
        await listener.add_listener("campusai_jobs", _on_notify)
    except Exception:  # noqa: BLE001
        log.warning("LISTEN/NOTIFY unavailable, polling only", exc_info=True)
        listener = None
    log.info("worker %s running", s.worker_id)
    last_reap = 0.0
    try:
        while stop is None or not stop.is_set():
            now = time.monotonic()
            if now - last_reap >= REAP_INTERVAL_SECONDS:
                try:
                    await reap_stuck()
                    last_reap = now
                except Exception:  # noqa: BLE001
                    log.warning("reaper tick failed", exc_info=True)
            try:
                worked = await process_one(s.worker_id)
            except Exception:  # noqa: BLE001
                log.exception("worker loop error")
                worked = False
            if not worked:
                wake.clear()
                try:
                    await asyncio.wait_for(wake.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
    finally:
        if listener is not None and not listener.is_closed():
            try:
                await listener.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":  # python -m campusai_ai.worker
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    from .embeddings import get_embedder

    get_embedder().warm_up()
    asyncio.run(run_forever())
