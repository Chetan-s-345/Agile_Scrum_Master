from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.models.agentic_sprint import AgenticSprintBuildRequest, AgenticSprintBuildResponse
from app.services.agentic_sprint_service import build_agentic_sprint

router = APIRouter(prefix="/agentic", tags=["agentic"])


@router.post("/sprint-build", response_model=AgenticSprintBuildResponse)
async def agentic_sprint_build(payload: AgenticSprintBuildRequest) -> AgenticSprintBuildResponse:
    try:
        return await build_agentic_sprint(req=payload)
    except RuntimeError as exc:
        message = str(exc)
        if "GROQ_API_KEY" in message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "LLM credentials missing. Set GROQ_API_KEY in "
                    "ai-service/.env and restart the AI service."
                ),
            ) from exc
        raise
