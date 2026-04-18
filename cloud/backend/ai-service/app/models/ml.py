from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ------------------------------
# 1) Developer Merit Scorer
# ------------------------------


class MeritFeatures(BaseModel):
    historical_velocity: float = Field(..., ge=0)
    ticket_completion_rate: float = Field(..., ge=0, le=1)
    complexity_handled: float = Field(..., ge=0)
    pr_review_score: float = Field(..., ge=0, le=1)


class MeritTrainSample(BaseModel):
    features: MeritFeatures
    merit_score: float = Field(..., ge=0, le=100)


class MeritTrainRequest(BaseModel):
    samples: list[MeritTrainSample]
    model_version: str = "v1"


class MeritPredictRequest(BaseModel):
    developer_id: Optional[str] = None
    features: MeritFeatures
    model_version: str = "v1"


class MeritPredictResponse(BaseModel):
    prediction_id: str
    developer_id: Optional[str]
    merit_score: float
    confidence: float
    model_version: str


# ------------------------------
# 2) Sprint Velocity Predictor
# ------------------------------


class VelocityTrainSample(BaseModel):
    # Past velocities (e.g., story points completed) ordered oldest->newest
    past_velocities: list[float] = Field(..., min_length=3)
    next_velocity: float = Field(..., ge=0)


class VelocityTrainRequest(BaseModel):
    samples: list[VelocityTrainSample]
    model_version: str = "v1"


class VelocityPredictRequest(BaseModel):
    sprint_id: Optional[str] = None
    past_velocities: list[float] = Field(..., min_length=3)
    model_version: str = "v1"


class VelocityPredictResponse(BaseModel):
    prediction_id: str
    sprint_id: Optional[str]
    predicted_velocity: float
    confidence: float
    model_version: str


# ------------------------------
# 3) Ticket Complexity Classifier
# ------------------------------


StoryPointBucket = Literal[1, 2, 3, 5, 8, 13]


class ComplexityTrainSample(BaseModel):
    title: str
    description: str | None = None
    story_points: int = Field(..., ge=1)


class ComplexityTrainRequest(BaseModel):
    samples: list[ComplexityTrainSample]
    model_version: str = "v1"
    # training knobs
    epochs: int = Field(default=2, ge=1, le=10)
    batch_size: int = Field(default=8, ge=1, le=64)
    learning_rate: float = Field(default=2e-5, gt=0)


class ComplexityPredictRequest(BaseModel):
    task_id: Optional[str] = None
    ticket_id: Optional[str] = None
    title: str
    description: str | None = None
    model_version: str = "v1"


class ComplexityPredictResponse(BaseModel):
    prediction_id: str
    task_id: Optional[str]
    ticket_id: Optional[str]
    predicted_story_points: int
    confidence: float
    model_version: str


# ------------------------------
# 4) Burndown Anomaly Detector
# ------------------------------


class BurndownPoint(BaseModel):
    day: date
    remaining_points: float = Field(..., ge=0)


class BurndownTrainSample(BaseModel):
    sprint_id: Optional[str] = None
    series: list[BurndownPoint] = Field(..., min_length=3)


class BurndownTrainRequest(BaseModel):
    samples: list[BurndownTrainSample]
    model_version: str = "v1"
    contamination: float = Field(default=0.1, gt=0, lt=0.5)


class BurndownDetectRequest(BaseModel):
    sprint_id: Optional[str] = None
    series: list[BurndownPoint] = Field(..., min_length=3)
    model_version: str = "v1"


class BurndownDetectResponse(BaseModel):
    prediction_id: str
    sprint_id: Optional[str]
    is_anomaly: bool
    anomaly_score: float
    confidence: float
    model_version: str
    details: dict[str, Any] = Field(default_factory=dict)
