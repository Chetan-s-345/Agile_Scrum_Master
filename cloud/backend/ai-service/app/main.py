from pathlib import Path
import os
import logging

from fastapi import FastAPI
from dotenv import load_dotenv

from app.routes import autonomous_router, agentic_sprint_router, groq_features_router, ml_router, sprint_planning_router
from app.services.db import close_pool, ensure_ml_schema

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="AI Sprint Manager - AI Service")
logger = logging.getLogger("ai-service")

_service_state = {
    "db_schema_ready": False,
    "db_schema_error": "",
    "db_persistence_enabled": False,
    "shutdown_error": "",
}

app.include_router(sprint_planning_router)
app.include_router(agentic_sprint_router)
app.include_router(autonomous_router)
app.include_router(groq_features_router)
app.include_router(ml_router)


@app.on_event("startup")
async def _startup():
    # Create ML tables if DATABASE_URL is provided.
    # If DATABASE_URL is missing, endpoints will still work but persistence will fail with a clear error.
    if not os.getenv("DATABASE_URL"):
        _service_state["db_schema_ready"] = False
        _service_state["db_schema_error"] = "DATABASE_URL is not set"
        _service_state["db_persistence_enabled"] = False
        logger.info("ai_service.startup.persistence_disabled_no_database_url")
        return

    try:
        await ensure_ml_schema()
        _service_state["db_schema_ready"] = True
        _service_state["db_schema_error"] = ""
        _service_state["db_persistence_enabled"] = True
    except Exception:
        # Avoid crashing the service for local dev while exposing state in /health.
        _service_state["db_schema_ready"] = False
        _service_state["db_schema_error"] = "ml schema initialization failed"
        _service_state["db_persistence_enabled"] = False
        logger.exception("ai_service.startup.ensure_ml_schema_failed")


@app.on_event("shutdown")
async def _shutdown():
    try:
        await close_pool()
        _service_state["shutdown_error"] = ""
    except Exception:
        _service_state["shutdown_error"] = "pool close failed"
        logger.exception("ai_service.shutdown.close_pool_failed")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "ai-service",
        "dbSchemaReady": _service_state["db_schema_ready"],
        "dbSchemaError": _service_state["db_schema_error"] or None,
        "dbPersistenceEnabled": _service_state["db_persistence_enabled"],
        "shutdownError": _service_state["shutdown_error"] or None,
    }
