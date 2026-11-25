"""Async Postgres access. Every query that touches ai.* tables takes an explicit user_id (blueprint 11.3)."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncpg
from pgvector.asyncpg import register_vector

from .config import get_settings

_pool: asyncpg.Pool | None = None
_pool_lock: asyncio.Lock | None = None


async def _init(conn: asyncpg.Connection) -> None:
    await register_vector(conn)
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def get_pool() -> asyncpg.Pool:
    global _pool, _pool_lock
    if _pool is not None:
        return _pool
    if _pool_lock is None:
        _pool_lock = asyncio.Lock()
    async with _pool_lock:
        if _pool is None:
            _pool = await asyncpg.create_pool(
                get_settings().db_dsn,
                min_size=1,
                max_size=10,
                command_timeout=60,
                max_inactive_connection_lifetime=300,
                init=_init,
            )
    return _pool


async def close_pool() -> None:
    global _pool, _pool_lock
    if _pool is not None:
        await _pool.close()
        _pool = None
    _pool_lock = None


async def fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetch(sql, *args)


async def fetchrow(sql: str, *args: Any) -> asyncpg.Record | None:
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetchrow(sql, *args)


async def fetchval(sql: str, *args: Any) -> Any:
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.fetchval(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    pool = await get_pool()
    async with pool.acquire() as c:
        return await c.execute(sql, *args)


@asynccontextmanager
async def tx(user_id: str | None = None) -> AsyncIterator[asyncpg.Connection]:
    """Transaction; records the acting user in a session variable (for RLS / auditing)."""
    pool = await get_pool()
    async with pool.acquire() as c:
        async with c.transaction():
            if user_id:
                await c.execute("select set_config('app.user_id', $1, true)", str(user_id))
            yield c
