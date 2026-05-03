"""
Free local embeddings using sentence-transformers (no API key needed).
Stores vectors in pgvector via the shared DATABASE_URL (same table as api-gateway).
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
from uuid import UUID
from typing import Any

import asyncpg
import numpy as np

logger = logging.getLogger("ai-service.embeddings")

_model = None
_pool: asyncpg.Pool | None = None

VECTOR_DIM = 384          # all-MiniLM-L6-v2 dimension
# Target vector dim used by the pgvector table.
TARGET_VECTOR_DIM = int(os.getenv("VECTOR_DIMENSIONS", os.getenv("VECTOR_DIM", "1536")))
TABLE = "embeddings"
_NIL_UUID = str(UUID(int=0))


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _model


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        url = os.getenv("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set")
        _pool = await asyncpg.create_pool(url, ssl="require", min_size=1, max_size=5)
    return _pool


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    return model.encode(texts, normalize_embeddings=True).tolist()


def _to_pgvector(vec: list[float]) -> str:
    # Ensure vector matches the DB's expected dimensionality by padding/truncating.
    v = list(vec)
    if len(v) < TARGET_VECTOR_DIM:
        v.extend([0.0] * (TARGET_VECTOR_DIM - len(v)))
    elif len(v) > TARGET_VECTOR_DIM:
        v = v[:TARGET_VECTOR_DIM]
    return "[" + ",".join(f"{val:.8f}" for val in v) + "]"


def _normalize_project_id(project_id: str | None) -> str:
    raw = str(project_id or "").strip()
    if not raw or raw.lower() in {"global", "none", "null"}:
        return _NIL_UUID
    try:
        return str(UUID(raw))
    except Exception:
        return _NIL_UUID


async def upsert_chunks(chunks: list[dict[str, Any]]) -> int:
    """chunks: list of {id, text, source_type, source_id, project_id, metadata}"""
    if not chunks:
        return 0
    pool = await _get_pool()
    texts = [c["text"] for c in chunks]
    vectors = embed_texts(texts)
    upserted = 0
    async with pool.acquire() as conn:
        for chunk, vec in zip(chunks, vectors):
            await conn.execute(
                f"""
                INSERT INTO {TABLE}
                  (id, source_type, source_id, project_id, content, vector, metadata, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, NOW())
                ON CONFLICT (source_id, source_type)
                DO UPDATE SET
                  content = EXCLUDED.content,
                  vector  = EXCLUDED.vector,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
                """,
                chunk["id"],
                chunk.get("source_type", "gitnexus"),
                chunk["source_id"],
                _normalize_project_id(chunk.get("project_id")),
                chunk["text"],
                _to_pgvector(vec),
                json.dumps(chunk.get("metadata", {})),
            )
            upserted += 1
    return upserted


async def delete_project_chunks(
    project_id: str | None,
    *,
    source_type: str = "gitnexus",
) -> int:
    """Delete existing vectors for a project/source before full snapshot re-ingestion."""
    pool = await _get_pool()
    normalized_project = _normalize_project_id(project_id)
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            DELETE FROM {TABLE}
            WHERE project_id = $1
              AND source_type = $2
            """,
            normalized_project,
            source_type,
        )
    try:
        return int(str(result).split()[-1])
    except Exception:
        return 0


async def query_similar(
    query: str,
    project_id: str = _NIL_UUID,
    source_types: list[str] | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    pool = await _get_pool()
    [qv] = embed_texts([query])
    qv_str = _to_pgvector(qv)
    type_filter = source_types if source_types else None
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, source_type, source_id, content, metadata,
                   1 - (vector <=> $1::vector) AS similarity
            FROM {TABLE}
            WHERE project_id = $2
              AND ($3::text[] IS NULL OR source_type = ANY($3::text[]))
            ORDER BY vector <=> $1::vector
            LIMIT $4
            """,
            qv_str, _normalize_project_id(project_id), type_filter, top_k,
        )
    results: list[dict[str, Any]] = []
    for r in rows:
        raw_meta = r.get("metadata")
        meta: dict[str, Any]
        if raw_meta is None:
            meta = {}
        elif isinstance(raw_meta, dict):
            meta = raw_meta
        else:
            try:
                meta = json.loads(raw_meta)
            except Exception:
                meta = {"raw": str(raw_meta)}

        results.append(
            {
                "id": r["id"],
                "source_type": r["source_type"],
                "source_id": r["source_id"],
                "content": r["content"],
                "metadata": meta,
                "similarity": float(r["similarity"]),
            }
        )

    return results


def chunk_text(text: str, size: int = 400, overlap: int = 64) -> list[str]:
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunks.append(" ".join(words[i: i + size]))
        if i + size >= len(words):
            break
        i += size - overlap
    return chunks
