from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from app.services.db import get_pool


def _id() -> str:
    return str(uuid.uuid4())


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


async def _try_get_pool():
    try:
        return await get_pool()
    except RuntimeError as exc:
        message = str(exc)
        if "DATABASE_URL is not set" in message or "asyncpg" in message:
            return None
        raise


async def insert_merit_prediction(
    *,
    developer_id: Optional[str],
    features: dict[str, Any],
    merit_score: float,
    confidence: float,
    model_version: str,
) -> str:
    pid = _id()
    pool = await _try_get_pool()
    if pool is None:
        return pid
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ml_merit_predictions (id, developer_id, features, merit_score, confidence, model_version)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6)
            """,
            pid,
            developer_id,
            json.dumps(features),
            float(merit_score),
            _clamp01(confidence),
            model_version,
        )
    return pid


async def insert_velocity_prediction(
    *,
    sprint_id: Optional[str],
    series: dict[str, Any],
    predicted_velocity: float,
    confidence: float,
    model_version: str,
) -> str:
    pid = _id()
    pool = await _try_get_pool()
    if pool is None:
        return pid
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ml_velocity_predictions (id, sprint_id, series, predicted_velocity, confidence, model_version)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6)
            """,
            pid,
            sprint_id,
            json.dumps(series),
            float(predicted_velocity),
            _clamp01(confidence),
            model_version,
        )
    return pid


async def insert_complexity_prediction(
    *,
    task_id: Optional[str],
    ticket_id: Optional[str],
    text_input: str,
    predicted_story_points: int,
    confidence: float,
    model_version: str,
) -> str:
    pid = _id()
    pool = await _try_get_pool()
    if pool is None:
        return pid
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ml_complexity_predictions (id, task_id, ticket_id, text_input, predicted_story_points, confidence, model_version)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            pid,
            task_id,
            ticket_id,
            text_input,
            int(predicted_story_points),
            _clamp01(confidence),
            model_version,
        )
    return pid


async def insert_burndown_anomaly(
    *,
    sprint_id: Optional[str],
    series: dict[str, Any],
    is_anomaly: bool,
    anomaly_score: float,
    confidence: float,
    model_version: str,
    details: Optional[dict[str, Any]] = None,
) -> str:
    pid = _id()
    pool = await _try_get_pool()
    if pool is None:
        return pid
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ml_burndown_anomalies (id, sprint_id, series, is_anomaly, anomaly_score, confidence, model_version, details)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb)
            """,
            pid,
            sprint_id,
            json.dumps(series),
            bool(is_anomaly),
            float(anomaly_score),
            _clamp01(confidence),
            model_version,
            json.dumps(details or {}),
        )
    return pid
