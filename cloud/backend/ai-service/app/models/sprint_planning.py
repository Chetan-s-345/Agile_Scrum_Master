from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


Priority = Literal["P0", "P1", "P2", "P3"]


class BacklogTicketIn(BaseModel):
    id: str
    title: str
    description: str | None = None
    labels: list[str] = Field(default_factory=list)
    story_points: int | None = None
    priority: Priority | None = None
    required_skills: list[str] = Field(default_factory=list)


class DeveloperProfileIn(BaseModel):
    id: str
    name: str
    tech_stack: list[str] = Field(default_factory=list)
    merit_score: float | None = None
    recent_velocity: float | None = None
    current_load_points: float | None = None
    sprint_capacity_points: float | None = None


class SprintPlanningConstraints(BaseModel):
    sprint_start: date | None = None
    sprint_end: date | None = None
    allow_over_capacity: bool = True


class SprintPlanningRequest(BaseModel):
    sprint_name: str
    backlog: list[BacklogTicketIn]
    developers: list[DeveloperProfileIn]
    constraints: SprintPlanningConstraints = Field(default_factory=SprintPlanningConstraints)


class TicketAnalysis(BaseModel):
    ticket_id: str
    complexity_points: int
    priority: Priority
    required_skills: list[str]


class DeveloperScore(BaseModel):
    developer_id: str
    score: float
    merit_component: float
    velocity_component: float
    skill_component: float
    load_component: float


class TicketAssignment(BaseModel):
    ticket_id: str
    developer_id: str
    confidence: float = Field(ge=0, le=1)
    score: float
    rationale: str


class RiskItem(BaseModel):
    category: str
    severity: Literal["low", "medium", "high"]
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class SprintPlanOut(BaseModel):
    sprint_name: str
    assignments: list[TicketAssignment]
    risks: list[RiskItem] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
