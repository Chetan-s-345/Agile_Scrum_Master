from __future__ import annotations

from fastapi import APIRouter

from app.models.agentic_sprint import AgenticSprintBuildRequest, AgenticSprintBuildResponse
from app.services.agentic_sprint_service import build_agentic_sprint

router = APIRouter(prefix="/agentic", tags=["agentic"])


@router.post("/sprint-build", response_model=AgenticSprintBuildResponse)
async def agentic_sprint_build(payload: AgenticSprintBuildRequest) -> AgenticSprintBuildResponse:
    return await build_agentic_sprint(req=payload)
