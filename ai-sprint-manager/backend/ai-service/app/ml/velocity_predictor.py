from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Tuple

import joblib
import numpy as np

from app.ml.artifacts import artifact_path

MODEL_NAME = "velocity_predictor"


@dataclass
class VelocityBundle:
    kind: Literal["linear", "lstm"]
    n: int
    rmse: float
    # linear params
    coef: np.ndarray | None = None
    intercept: float | None = None
    # lstm metadata
    hidden_size: int | None = None
    num_layers: int | None = None


def _bundle_path(model_version: str) -> str:
    return str(artifact_path(MODEL_NAME, model_version, "bundle.joblib"))


def _lstm_weights_path(model_version: str) -> str:
    return str(artifact_path(MODEL_NAME, model_version, "model.pt"))


def _to_fixed_window(series: List[float], n: int) -> np.ndarray:
    vals = np.array([float(v) for v in series], dtype=np.float32)
    if len(vals) < n:
        # left-pad with first value
        pad = np.full((n - len(vals),), float(vals[0]), dtype=np.float32)
        vals = np.concatenate([pad, vals], axis=0)
    return vals[-n:]


def train_velocity_model(samples: List[dict[str, Any]], model_version: str = "v1", window: int = 10) -> Dict[str, Any]:
    if len(samples) < 30:
        raise ValueError("Need at least 30 samples to train velocity predictor")

    X = np.stack([_to_fixed_window(s["past_velocities"], window) for s in samples])
    y = np.array([float(s["next_velocity"]) for s in samples], dtype=np.float32)

    # Prefer a lightweight LSTM when torch is available.
    try:
        import torch
        import torch.nn as nn
    except Exception:
        torch = None  # type: ignore
        nn = None  # type: ignore

    if torch is None or nn is None:
        # Closed-form ridge-like linear fallback
        X_ = np.concatenate([X, np.ones((X.shape[0], 1), dtype=np.float32)], axis=1)
        l2 = 1e-3
        A = X_.T @ X_ + l2 * np.eye(X_.shape[1], dtype=np.float32)
        b = X_.T @ y
        w = np.linalg.solve(A, b)

        coef = w[:-1]
        intercept = float(w[-1])

        pred = X @ coef + intercept
        rmse = float(np.sqrt(np.mean((pred - y) ** 2)))

        bundle = VelocityBundle(kind="linear", coef=coef, intercept=intercept, n=window, rmse=rmse)
        joblib.dump(bundle, _bundle_path(model_version))
        return {"model_version": model_version, "samples": len(samples), "window": window, "rmse": rmse, "kind": "linear"}

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    class LSTMRegressor(nn.Module):
        def __init__(self, hidden_size: int = 16, num_layers: int = 1):
            super().__init__()
            self.lstm = nn.LSTM(input_size=1, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)
            self.fc = nn.Linear(hidden_size, 1)

        def forward(self, x):
            # x: (B, T, 1)
            out, _ = self.lstm(x)
            last = out[:, -1, :]
            return self.fc(last).squeeze(-1)

    hidden_size = 16
    num_layers = 1
    model = LSTMRegressor(hidden_size=hidden_size, num_layers=num_layers).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)
    loss_fn = nn.MSELoss()

    X_t = torch.tensor(X.reshape(X.shape[0], X.shape[1], 1), dtype=torch.float32, device=device)
    y_t = torch.tensor(y, dtype=torch.float32, device=device)

    model.train()
    epochs = 200 if len(samples) < 200 else 120
    for _ in range(epochs):
        opt.zero_grad()
        pred = model(X_t)
        loss = loss_fn(pred, y_t)
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        pred = model(X_t).detach().cpu().numpy()
    rmse = float(np.sqrt(np.mean((pred - y) ** 2)))

    torch.save(model.state_dict(), _lstm_weights_path(model_version))
    bundle = VelocityBundle(kind="lstm", n=window, rmse=rmse, hidden_size=hidden_size, num_layers=num_layers)
    joblib.dump(bundle, _bundle_path(model_version))

    return {"model_version": model_version, "samples": len(samples), "window": window, "rmse": rmse, "kind": "lstm"}


def _load_bundle(model_version: str) -> VelocityBundle:
    path = _bundle_path(model_version)
    try:
        return joblib.load(path)
    except FileNotFoundError as e:
        raise FileNotFoundError(
            f"Velocity model '{model_version}' not trained yet. Train via /ml/velocity/train first."
        ) from e


def predict_velocity(past_velocities: List[float], model_version: str = "v1") -> Tuple[float, float, Dict[str, Any]]:
    bundle = _load_bundle(model_version)
    x = _to_fixed_window(past_velocities, bundle.n)

    if bundle.kind == "linear":
        coef = bundle.coef
        intercept = bundle.intercept
        if coef is None or intercept is None:
            raise RuntimeError("Velocity bundle is missing linear parameters")
        pred = float(x @ coef + float(intercept))
        pred = max(0.0, pred)
        conf = float(1.0 / (1.0 + (bundle.rmse / max(pred, 1.0))))
        conf = float(np.clip(conf, 0.05, 0.98))
        return pred, conf, {"window": bundle.n, "rmse": bundle.rmse, "kind": bundle.kind}

    # LSTM path
    try:
        import torch
        import torch.nn as nn
    except Exception as e:
        raise RuntimeError("torch is required for LSTM velocity inference but is not installed") from e

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    class LSTMRegressor(nn.Module):
        def __init__(self, hidden_size: int, num_layers: int):
            super().__init__()
            self.lstm = nn.LSTM(input_size=1, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)
            self.fc = nn.Linear(hidden_size, 1)

        def forward(self, x):
            out, _ = self.lstm(x)
            last = out[:, -1, :]
            return self.fc(last).squeeze(-1)

    if bundle.hidden_size is None or bundle.num_layers is None:
        raise RuntimeError("Velocity bundle missing LSTM metadata")

    model = LSTMRegressor(hidden_size=int(bundle.hidden_size), num_layers=int(bundle.num_layers)).to(device)
    state = torch.load(_lstm_weights_path(model_version), map_location=device)
    model.load_state_dict(state)
    model.eval()

    X_t = torch.tensor(x.reshape(1, bundle.n, 1), dtype=torch.float32, device=device)
    with torch.no_grad():
        pred = float(model(X_t).detach().cpu().numpy().item())
    pred = max(0.0, pred)

    conf = float(1.0 / (1.0 + (bundle.rmse / max(pred, 1.0))))
    conf = float(np.clip(conf, 0.05, 0.98))
    return pred, conf, {"window": bundle.n, "rmse": bundle.rmse, "kind": bundle.kind}
