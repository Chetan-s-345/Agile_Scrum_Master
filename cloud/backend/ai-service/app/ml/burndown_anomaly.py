from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from app.ml.artifacts import artifact_path
from app.models.ml import BurndownPoint, BurndownTrainSample


MODEL_NAME = "burndown_anomaly"


@dataclass
class BurndownModelBundle:
    model: IsolationForest
    max_len: int


def _bundle_path(model_version: str) -> str:
    return str(artifact_path(MODEL_NAME, model_version, "bundle.joblib"))


def _series_to_vector(series: List[BurndownPoint], max_len: int) -> np.ndarray:
    # Sort by day
    pts = sorted(series, key=lambda p: p.day)
    values = np.array([float(p.remaining_points) for p in pts], dtype=np.float32)
    if len(values) < 3:
        raise ValueError("Burndown series must have at least 3 points")

    # Normalize by starting points
    start = max(values[0], 1.0)
    norm = values / start

    # Resample/Pad to max_len (simple: pad last value)
    if len(norm) >= max_len:
        norm = norm[:max_len]
    else:
        pad = np.full((max_len - len(norm),), float(norm[-1]), dtype=np.float32)
        norm = np.concatenate([norm, pad], axis=0)

    # Add simple derivative features
    d1 = np.diff(norm, prepend=norm[0])
    d2 = np.diff(d1, prepend=d1[0])

    return np.concatenate([norm, d1, d2], axis=0)


def train_burndown_model(samples: List[BurndownTrainSample], model_version: str = "v1", contamination: float = 0.1) -> Dict[str, Any]:
    if len(samples) < 30:
        raise ValueError("Need at least 30 burndown samples to train anomaly detector")

    max_len = int(max(len(s.series) for s in samples))
    max_len = max(7, min(max_len, 60))

    X = np.stack([_series_to_vector(s.series, max_len=max_len) for s in samples])

    model = IsolationForest(
        n_estimators=300,
        contamination=float(contamination),
        random_state=42,
    )
    model.fit(X)

    bundle = BurndownModelBundle(model=model, max_len=max_len)
    joblib.dump(bundle, _bundle_path(model_version))

    return {"model_version": model_version, "samples": len(samples), "max_len": max_len, "contamination": contamination}


def _load_bundle(model_version: str) -> BurndownModelBundle:
    path = _bundle_path(model_version)
    try:
        return joblib.load(path)
    except FileNotFoundError as e:
        raise FileNotFoundError(
            f"Burndown anomaly model '{model_version}' not trained yet. Train via /ml/burndown/train first."
        ) from e


def detect_anomaly(series: List[BurndownPoint], model_version: str = "v1") -> Tuple[bool, float, float, Dict[str, Any]]:
    bundle = _load_bundle(model_version)
    x = _series_to_vector(series, max_len=bundle.max_len).reshape(1, -1)

    # IsolationForest: -1 is anomaly, 1 is normal
    pred = int(bundle.model.predict(x)[0])
    is_anomaly = pred == -1

    # decision_function higher => more normal. score_samples lower => more anomalous.
    normality = float(bundle.model.decision_function(x)[0])
    anomaly_score = -normality

    # Confidence heuristic: squashed normality into 0..1
    confidence = 1.0 / (1.0 + np.exp(-3.0 * abs(normality)))
    confidence = float(np.clip(confidence, 0.05, 0.98))

    details = {
        "max_len": bundle.max_len,
        "normality": normality,
    }
    return is_anomaly, anomaly_score, confidence, details
