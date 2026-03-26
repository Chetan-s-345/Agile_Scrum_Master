from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/autonomous", tags=["autonomous"])


class AutopilotRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    pending_approvals: int = Field(default=0, ge=0)
    at_risk_tasks: int = Field(default=0, ge=0)


class TeamMemberLoad(BaseModel):
    member_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    workload: int = Field(default=0, ge=0)


class TeamRebalanceRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    members: list[TeamMemberLoad] = Field(default_factory=list)


class BriefingRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    highlights: list[str] = Field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@router.post("/autopilot")
async def autopilot(payload: AutopilotRequest) -> dict[str, Any]:
    mode = "autonomous" if payload.pending_approvals == 0 else "guarded"
    risk = "high" if payload.at_risk_tasks > 5 else "normal"
    summary = (
        f"Autopilot mode is {mode}. "
        f"Pending approvals: {payload.pending_approvals}. "
        f"At-risk tasks: {payload.at_risk_tasks}."
    )
    return {"projectId": payload.project_id, "mode": mode, "risk": risk, "summary": summary, "updatedAt": _now_iso()}


@router.post("/team-rebalance")
async def team_rebalance(payload: TeamRebalanceRequest) -> dict[str, Any]:
    if len(payload.members) < 2:
        return {"projectId": payload.project_id, "recommendation": "Not enough members to rebalance.", "updatedAt": _now_iso()}

    ordered = sorted(payload.members, key=lambda member: member.workload, reverse=True)
    source = ordered[0]
    target = ordered[-1]
    delta = source.workload - target.workload
    recommendation = "Team load is balanced." if delta < 2 else f"Move one upcoming task from {source.name} to {target.name}."
    return {"projectId": payload.project_id, "source": source.model_dump(), "target": target.model_dump(), "delta": delta, "recommendation": recommendation, "updatedAt": _now_iso()}


@router.post("/briefing")
async def briefing(payload: BriefingRequest) -> dict[str, Any]:
    lines = [
        "Morning Briefing",
        f"Generated at: {_now_iso()}",
        f"Focus: {payload.prompt.strip()}",
    ]
    for item in payload.highlights[:6]:
        lines.append(f"- {item.strip()}")
    if not payload.highlights:
        lines.append("- No highlights provided. Review approvals, risks, and delivery blockers.")
    return {"briefing": "\n".join(lines), "summary": lines[-1], "updatedAt": _now_iso()}
