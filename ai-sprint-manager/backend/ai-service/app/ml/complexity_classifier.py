from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import numpy as np

from app.ml.artifacts import artifact_path
from app.models.ml import ComplexityTrainSample


MODEL_NAME = "complexity_classifier"
BUCKETS = [1, 2, 3, 5, 8, 13]


def _nearest_bucket(points: int) -> int:
    return int(min(BUCKETS, key=lambda b: abs(b - int(points))))


def _model_dir(model_version: str) -> str:
    return str(artifact_path(MODEL_NAME, model_version))


def train_complexity_model(
    samples: List[ComplexityTrainSample],
    model_version: str = "v1",
    epochs: int = 2,
    batch_size: int = 8,
    learning_rate: float = 2e-5,
) -> Dict[str, Any]:
    if len(samples) < 50:
        raise ValueError("Need at least 50 labeled tickets to fine-tune DistilBERT")

    try:
        import torch
        from torch.utils.data import DataLoader
        from transformers import AutoModelForSequenceClassification, AutoTokenizer  # pyright: ignore[reportMissingImports]
    except Exception as e:
        raise RuntimeError(
            "Missing dependencies for complexity classifier. Install torch + transformers in ai-service."
        ) from e

    texts: List[str] = []
    labels: List[int] = []
    for s in samples:
        text = f"{s.title}\n\n{s.description or ''}".strip()
        texts.append(text)
        labels.append(BUCKETS.index(_nearest_bucket(int(s.story_points))))

    # Simple train/val split
    idx = np.arange(len(texts))
    rng = np.random.default_rng(42)
    rng.shuffle(idx)
    split = int(0.8 * len(idx))
    train_idx = idx[:split]
    val_idx = idx[split:]

    model_name = "distilbert-base-uncased"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=len(BUCKETS))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    def enc(i: int):
        return tokenizer(texts[i], truncation=True, padding="max_length", max_length=256, return_tensors="pt")

    class DS(torch.utils.data.Dataset):
        def __init__(self, indices):
            self.indices = list(indices)

        def __len__(self):
            return len(self.indices)

        def __getitem__(self, j):
            i = int(self.indices[j])
            out = enc(i)
            item = {k: v.squeeze(0) for k, v in out.items()}
            item["labels"] = torch.tensor(int(labels[i]), dtype=torch.long)
            return item

    train_ds = DS(train_idx)
    val_ds = DS(val_idx)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    opt = torch.optim.AdamW(model.parameters(), lr=float(learning_rate))

    def run_eval() -> float:
        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for batch in val_loader:
                batch = {k: v.to(device) for k, v in batch.items()}
                logits = model(**{k: v for k, v in batch.items() if k != "labels"}).logits
                pred = torch.argmax(logits, dim=-1)
                correct += int((pred == batch["labels"]).sum().item())
                total += int(batch["labels"].shape[0])
        return float(correct / max(1, total))

    model.train()
    for _ in range(int(epochs)):
        for batch in train_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            out = model(**batch)
            loss = out.loss
            loss.backward()
            opt.step()
            opt.zero_grad(set_to_none=True)

    acc = run_eval()

    out_dir = _model_dir(model_version)
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)

    return {"model_version": model_version, "samples": len(samples), "val_accuracy": acc, "buckets": BUCKETS}


def predict_complexity(title: str, description: str | None, model_version: str = "v1") -> Tuple[int, float, Dict[str, Any]]:
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer  # pyright: ignore[reportMissingImports]
    except Exception as e:
        raise RuntimeError("Missing dependencies for complexity classifier. Install torch + transformers.") from e

    out_dir = _model_dir(model_version)
    try:
        tokenizer = AutoTokenizer.from_pretrained(out_dir)
        model = AutoModelForSequenceClassification.from_pretrained(out_dir)
    except Exception as e:
        raise FileNotFoundError(
            f"Complexity model '{model_version}' not trained yet. Train via /ml/complexity/train first."
        ) from e

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()

    text = f"{title}\n\n{description or ''}".strip()
    enc = tokenizer(text, truncation=True, padding=True, max_length=256, return_tensors="pt")
    enc = {k: v.to(device) for k, v in enc.items()}

    with torch.no_grad():
        logits = model(**enc).logits
        probs = torch.softmax(logits, dim=-1).detach().cpu().numpy().flatten()

    best = int(np.argmax(probs))
    confidence = float(np.clip(probs[best], 0.05, 0.98))
    predicted = int(BUCKETS[best])

    meta = {"buckets": BUCKETS}
    return predicted, confidence, meta
