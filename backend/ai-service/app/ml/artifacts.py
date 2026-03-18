from __future__ import annotations

import os
from pathlib import Path


def artifacts_dir() -> Path:
    raw = os.getenv("ML_ARTIFACTS_DIR") or str(Path(__file__).resolve().parents[2] / "artifacts")
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


def artifact_path(*parts: str) -> Path:
    p = artifacts_dir().joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
