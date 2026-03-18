from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.ml import (
    detect_anomaly,
    predict_complexity,
    predict_merit,
    predict_velocity,
    train_burndown_model,
    train_complexity_model,
    train_merit_model,
    train_velocity_model,
)
from app.models.ml import (
    BurndownDetectRequest,
    BurndownDetectResponse,
    BurndownTrainRequest,
    ComplexityPredictRequest,
    ComplexityPredictResponse,
    ComplexityTrainRequest,
    MeritPredictRequest,
    MeritPredictResponse,
    MeritTrainRequest,
    VelocityPredictRequest,
    VelocityPredictResponse,
    VelocityTrainRequest,
)
from app.services.ml_persistence import (
    insert_burndown_anomaly,
    insert_complexity_prediction,
    insert_merit_prediction,
    insert_velocity_prediction,
)

router = APIRouter(prefix="/ml", tags=["ml-internal"])


@router.post("/merit/train")
def merit_train(req: MeritTrainRequest):
    try:
        return train_merit_model([s for s in req.samples], model_version=req.model_version)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/merit/predict", response_model=MeritPredictResponse)
async def merit_predict(req: MeritPredictRequest):
    try:
        merit, confidence, _meta = predict_merit(req.features, model_version=req.model_version)
        pid = await insert_merit_prediction(
            developer_id=req.developer_id,
            features=req.features.model_dump(),
            merit_score=merit,
            confidence=confidence,
            model_version=req.model_version,
        )
        return MeritPredictResponse(
            prediction_id=pid,
            developer_id=req.developer_id,
            merit_score=merit,
            confidence=confidence,
            model_version=req.model_version,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/velocity/train")
def velocity_train(req: VelocityTrainRequest):
    try:
        samples = [{"past_velocities": s.past_velocities, "next_velocity": s.next_velocity} for s in req.samples]
        return train_velocity_model(samples, model_version=req.model_version, window=10)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/velocity/predict", response_model=VelocityPredictResponse)
async def velocity_predict(req: VelocityPredictRequest):
    try:
        pred, confidence, _meta = predict_velocity(req.past_velocities, model_version=req.model_version)
        pid = await insert_velocity_prediction(
            sprint_id=req.sprint_id,
            series={"past_velocities": req.past_velocities},
            predicted_velocity=pred,
            confidence=confidence,
            model_version=req.model_version,
        )
        return VelocityPredictResponse(
            prediction_id=pid,
            sprint_id=req.sprint_id,
            predicted_velocity=pred,
            confidence=confidence,
            model_version=req.model_version,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/complexity/train")
def complexity_train(req: ComplexityTrainRequest):
    try:
        return train_complexity_model(
            [s for s in req.samples],
            model_version=req.model_version,
            epochs=req.epochs,
            batch_size=req.batch_size,
            learning_rate=req.learning_rate,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/complexity/predict", response_model=ComplexityPredictResponse)
async def complexity_predict(req: ComplexityPredictRequest):
    try:
        points, confidence, _meta = predict_complexity(req.title, req.description, model_version=req.model_version)
        pid = await insert_complexity_prediction(
            task_id=req.task_id,
            ticket_id=req.ticket_id,
            text_input=f"{req.title}\n\n{req.description or ''}".strip(),
            predicted_story_points=int(points),
            confidence=confidence,
            model_version=req.model_version,
        )
        return ComplexityPredictResponse(
            prediction_id=pid,
            task_id=req.task_id,
            ticket_id=req.ticket_id,
            predicted_story_points=int(points),
            confidence=confidence,
            model_version=req.model_version,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/burndown/train")
def burndown_train(req: BurndownTrainRequest):
    try:
        return train_burndown_model(
            [s for s in req.samples],
            model_version=req.model_version,
            contamination=req.contamination,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/burndown/detect", response_model=BurndownDetectResponse)
async def burndown_detect(req: BurndownDetectRequest):
    try:
        is_anom, score, confidence, details = detect_anomaly(req.series, model_version=req.model_version)
        pid = await insert_burndown_anomaly(
            sprint_id=req.sprint_id,
            series={
                "points": [{"day": p.day.isoformat(), "remaining_points": p.remaining_points} for p in req.series]
            },
            is_anomaly=is_anom,
            anomaly_score=score,
            confidence=confidence,
            model_version=req.model_version,
            details=details,
        )
        return BurndownDetectResponse(
            prediction_id=pid,
            sprint_id=req.sprint_id,
            is_anomaly=is_anom,
            anomaly_score=score,
            confidence=confidence,
            model_version=req.model_version,
            details=details,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
