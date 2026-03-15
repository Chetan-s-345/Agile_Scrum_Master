from fastapi import FastAPI

from app.routes import sprint_planning_router

app = FastAPI(title="AI Sprint Manager - AI Service")

app.include_router(sprint_planning_router)


@app.get("/health")
def health():
    return {"ok": True, "service": "ai-service"}
