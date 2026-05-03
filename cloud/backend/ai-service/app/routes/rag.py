from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.models.rag import IngestGitnexusRequest, RagChatRequest, QueryChunksRequest
from app.services.embeddings import upsert_chunks, query_similar, chunk_text, delete_project_chunks
from app.services.groq_stream import groq_chat

router = APIRouter(prefix="/rag", tags=["rag"])
_NIL_UUID = str(UUID(int=0))


def _require_project_id(project_id: str) -> str:
    raw = str(project_id or "").strip()
    try:
        parsed = str(UUID(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="project_id must be a valid UUID") from exc

    if parsed == _NIL_UUID:
        raise HTTPException(status_code=400, detail="project_id is required for RAG chat")
    return parsed


def _build_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return "(No relevant repository context found. Answer from general knowledge.)"

    return "\n---\n".join(
        f"[{i + 1}] FILE: {c['metadata'].get('file_path', '?')}\n{c['content']}"
        for i, c in enumerate(chunks)
    )


async def _build_rag_prompt(req: RagChatRequest) -> tuple[str, list[dict]]:
    chunks = await query_similar(req.message, req.project_id, req.source_types, top_k=5)
    context_block = _build_context_block(chunks)
    system = (
        "You are an expert Agile Scrum Master AI with access to the project repository.\n"
        "Use the REPOSITORY CONTEXT below to answer. Cite file paths when relevant.\n\n"
        "REPOSITORY CONTEXT:\n" + context_block
    )
    return system, chunks


@router.post("/ingest")
async def ingest_gitnexus(req: IngestGitnexusRequest):
    """
    Called by Inngest every 6h with files from GitNexus.
    Chunks each file, embeds locally (free), upserts to pgvector.
    """
    all_chunks: list[dict] = []
    for f in req.files:
        path = str(f.get("path", "unknown"))
        content = str(f.get("content", ""))
        if not content.strip():
            continue
        parts = chunk_text(content)
        for i, text in enumerate(parts):
            all_chunks.append({
                "id": f"{path}::{req.commit_sha}::{i}",
                "source_id": f"{path}::{req.commit_sha}::{i}",
                "source_type": "gitnexus",
                "project_id": req.project_id,
                "text": text,
                "metadata": {
                    "file_path": path,
                    "repo": req.repo,
                    "commit_sha": req.commit_sha,
                    "chunk_index": i,
                },
            })
    project_id = _require_project_id(req.project_id)
    deleted = await delete_project_chunks(project_id, source_type="gitnexus")
    for chunk in all_chunks:
        chunk["project_id"] = project_id

    upserted = await upsert_chunks(all_chunks)
    return {"ok": True, "deleted": deleted, "upserted": upserted, "files": len(req.files), "project_id": project_id}


@router.post("/query")
async def query_chunks(req: QueryChunksRequest):
    project_id = _require_project_id(req.project_id)
    results = await query_similar(req.query, project_id, top_k=req.top_k)
    return {"results": results}


@router.post("/chat")
async def rag_chat(req: RagChatRequest):
    """Single RAG chat function: retrieve context, ask Groq, return answer plus sources."""
    req.project_id = _require_project_id(req.project_id)
    system, chunks = await _build_rag_prompt(req)
    if not chunks:
        return {
            "ok": False,
            "answer": "No indexed repository context found for this project. Run ingestion before chatting.",
            "chunks_retrieved": 0,
            "sources": [],
            "error": "No indexed data",
            "code": 404,
            "detail": "No gitnexus chunks found for the provided project_id.",
        }

    answer = await groq_chat(system=system, user=req.message, max_tokens=1000, temperature=0.2)
    return {
        "ok": True,
        "answer": answer,
        "chunks_retrieved": len(chunks),
        "sources": [
            {
                "id": chunk["id"],
                "source_id": chunk["source_id"],
                "source_type": chunk["source_type"],
                "similarity": chunk["similarity"],
                "metadata": chunk["metadata"],
            }
            for chunk in chunks
        ],
    }


@router.post("/chat/stream")
async def rag_chat_stream(req: RagChatRequest):
    """Compatibility SSE wrapper over the single RAG chat function."""
    payload = await rag_chat(req)

    async def gen():
        yield f"event: meta\ndata: {json.dumps({'chunks_retrieved': payload['chunks_retrieved']}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'answer': payload['answer'], 'sources': payload['sources']}, ensure_ascii=False)}\n\n"
        yield f"event: done\ndata: {json.dumps({'ok': True}, ensure_ascii=False)}\n\n"

    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
