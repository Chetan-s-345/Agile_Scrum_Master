from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.ml.artifacts import artifact_path
from app.models.ml import MeritFeatures, MeritTrainSample


MODEL_NAME = "merit_scorer"


@dataclass
class MeritModelBundle:
    model: Pipeline
    feature_mean: np.ndarray
    feature_std: np.ndarray
    r2: float


def _features_to_vector(f: MeritFeatures) -> np.ndarray:
    return np.array(
        [
            float(f.historical_velocity),
            float(f.ticket_completion_rate),
            float(f.complexity_handled),
            float(f.pr_review_score),
        ],
        dtype=np.float32,
    )


def _bundle_path(model_version: str) -> str:
    return str(artifact_path(MODEL_NAME, model_version, "bundle.joblib"))


def train_merit_model(samples: List[MeritTrainSample], model_version: str = "v1") -> Dict[str, Any]:
    if len(samples) < 20:
        raise ValueError("Need at least 20 samples to train merit scorer")

    X = np.stack([_features_to_vector(s.features) for s in samples])
    y = np.array([float(s.merit_score) for s in samples], dtype=np.float32)

    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

    model = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "rf",
                RandomForestRegressor(
                    n_estimators=300,
                    random_state=42,
                    min_samples_leaf=2,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_val)
    r2 = float(r2_score(y_val, y_pred))

    feature_mean = X.mean(axis=0)
    feature_std = X.std(axis=0) + 1e-6

    bundle = MeritModelBundle(model=model, feature_mean=feature_mean, feature_std=feature_std, r2=r2)
    joblib.dump(bundle, _bundle_path(model_version))

    return {
        "model_version": model_version,
        "samples": len(samples),
        "r2": r2,
    }


def _load_bundle(model_version: str) -> MeritModelBundle:
    path = _bundle_path(model_version)
    try:
        return joblib.load(path)
    except FileNotFoundError as e:
        raise FileNotFoundError(
            f"Merit model '{model_version}' not trained yet. Train via /ml/merit/train first."
        ) from e


def predict_merit(features: MeritFeatures, model_version: str = "v1") -> Tuple[float, float, Dict[str, Any]]:
    bundle = _load_bundle(model_version)
    x = _features_to_vector(features).reshape(1, -1)
    raw = float(bundle.model.predict(x)[0])

    merit = max(0.0, min(100.0, raw))

    # Confidence heuristic: based on validation r2 and how far this point is from the training distribution.
    z = np.abs((x.flatten() - bundle.feature_mean) / bundle.feature_std)
    dist_penalty = float(np.clip(z.mean() / 4.0, 0.0, 1.0))  # 0 near train mean, ->1 far

    base = float(np.clip((bundle.r2 + 1.0) / 2.0, 0.05, 0.98))  # map [-1,1] -> [0,1]
    confidence = float(np.clip(base * (1.0 - 0.6 * dist_penalty), 0.05, 0.98))

    meta = {
        "r2": bundle.r2,
        "avg_z": float(z.mean()),
    }
    return merit, confidence, meta
