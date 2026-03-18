from __future__ import annotations

from app.services.db.pool import get_pool


DDL = r"""
CREATE TABLE IF NOT EXISTS ml_merit_predictions (
  id TEXT PRIMARY KEY,
  developer_id TEXT,
  features JSONB NOT NULL,
  merit_score DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ml_merit_predictions_developer_id_created_at
  ON ml_merit_predictions(developer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ml_velocity_predictions (
  id TEXT PRIMARY KEY,
  sprint_id TEXT,
  series JSONB NOT NULL,
  predicted_velocity DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ml_velocity_predictions_sprint_id_created_at
  ON ml_velocity_predictions(sprint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ml_complexity_predictions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  ticket_id TEXT,
  text_input TEXT NOT NULL,
  predicted_story_points INT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ml_complexity_predictions_task_id_created_at
  ON ml_complexity_predictions(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ml_burndown_anomalies (
  id TEXT PRIMARY KEY,
  sprint_id TEXT,
  series JSONB NOT NULL,
  is_anomaly BOOLEAN NOT NULL,
  anomaly_score DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  model_version TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ml_burndown_anomalies_sprint_id_created_at
  ON ml_burndown_anomalies(sprint_id, created_at DESC);
"""


async def ensure_ml_schema() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        # asyncpg can execute multiple statements.
        await conn.execute(DDL)
