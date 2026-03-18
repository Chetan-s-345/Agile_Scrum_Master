from __future__ import annotations

import os
from typing import Any, Optional

try:
    import asyncpg
except ModuleNotFoundError:  # pragma: no cover - depends on local runtime setup
    asyncpg = None  # type: ignore[assignment]

_pool: Optional[Any] = None


def _get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set; cannot persist ML predictions to Neon/Postgres")
    return url


async def get_pool() -> asyncpg.Pool:
    global _pool
    if asyncpg is None:
        raise RuntimeError(
            "Missing dependency 'asyncpg'. Install ai-service dependencies with: "
            "pip install -r ai-sprint-manager/backend/ai-service/requirements.txt"
        )
    if _pool is None:
        _pool = await asyncpg.create_pool(dsn=_get_database_url(), min_size=1, max_size=5)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
