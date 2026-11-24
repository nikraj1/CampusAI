from __future__ import annotations

import uuid

from .. import db


async def progress(job_id, stage: str, pct: int) -> None:
    await db.execute("update app.jobs set stage=$2, progress=$3, updated_at=now() where id=$1", job_id if isinstance(job_id, uuid.UUID) else uuid.UUID(str(job_id)), stage, pct)
