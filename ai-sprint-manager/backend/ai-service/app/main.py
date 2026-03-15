from fastapi import FastAPI

from app.routes import agentic_sprint_router, groq_features_router, ml_router, sprint_planning_router
from app.services.db import close_pool, ensure_ml_schema

app = FastAPI(title="AI Sprint Manager - AI Service")

app.include_router(sprint_planning_router)
app.include_router(agentic_sprint_router)
app.include_router(groq_features_router)
app.include_router(ml_router)


@app.on_event("startup")
async def _startup():
    # Create ML tables if DATABASE_URL is provided.
    # If DATABASE_URL is missing, endpoints will still work but persistence will fail with a clear error.
    try:
        await ensure_ml_schema()
    except Exception:
        # Avoid crashing the service for local dev without DB.
        pass


@app.on_event("shutdown")
async def _shutdown():
    try:
        await close_pool()
    except Exception:
        pass


@app.get("/health")
def health():
    return {"ok": True, "service": "ai-service"}
