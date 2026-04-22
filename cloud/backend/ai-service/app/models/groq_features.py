from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TicketEnrichmentRequest(BaseModel):
    title: str
    context: str | None = None


class StandupEntry(BaseModel):
    developer_id: str
    developer_name: str | None = None
    yesterday: str | None = None
    today: str | None = None
    blockers: str | None = None


class StandupSummarizerRequest(BaseModel):
    sprint_name: str | None = None
    entries: list[StandupEntry]


class RetrospectiveGeneratorRequest(BaseModel):
    sprint_name: str | None = None
    velocity: float | None = None
    completion_rate: float | None = None
    blockers: list[str] = Field(default_factory=list)
    notes: str | None = None


class RiskNarratorRequest(BaseModel):
    sprint_name: str | None = None
    health: dict[str, Any] = Field(default_factory=dict)
    audience: Literal["engineering", "product", "stakeholders"] = "stakeholders"


class MeetingSummarizerRequest(BaseModel):
    meeting_title: str | None = None
    meeting_type: str | None = None
    transcript: str
    notes: list[str] = Field(default_factory=list)
