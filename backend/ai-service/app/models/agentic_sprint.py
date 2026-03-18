from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.models.sprint_planning import DeveloperProfileIn, SprintPlanningConstraints


class AgenticSprintBuildRequest(BaseModel):
    sprint_name: str = Field(..., min_length=1)
    project_details: str = Field(..., min_length=10)
    developers: list[DeveloperProfileIn] = Field(default_factory=list)
    constraints: SprintPlanningConstraints = Field(default_factory=SprintPlanningConstraints)

    max_tickets: int = Field(default=12, ge=3, le=30)


class AgenticSprintGeneratedTicket(BaseModel):
    title: str
    description: str | None = None
    labels: list[str] = Field(default_factory=list)
    story_points: int | None = None
    priority: str | None = None
    required_skills: list[str] = Field(default_factory=list)


class AgenticSprintBuildResponse(BaseModel):
    sprint_name: str
    sprint_goal: str | None = None
    generated_tickets: list[dict] = Field(default_factory=list)
    selected_ticket_ids: list[str] = Field(default_factory=list)
    final_plan: dict | None = None
    transcript: list[dict] = Field(default_factory=list)
