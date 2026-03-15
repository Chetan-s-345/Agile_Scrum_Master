from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.groq_features import (
    RetrospectiveGeneratorRequest,
    RiskNarratorRequest,
    StandupSummarizerRequest,
    TicketEnrichmentRequest,
)
from app.services.groq_stream import groq_stream_chat, sse_data, sse_event

router = APIRouter(prefix="/groq", tags=["groq"])


def _sse_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        # Nginx buffering off (harmless elsewhere)
        "X-Accel-Buffering": "no",
    }


@router.post("/ticket-enrichment/stream")
async def ticket_enrichment_stream(req: TicketEnrichmentRequest):
    system = (
        "You are an expert Agile Scrum Master assistant. "
        "Given a raw ticket title, enrich it for a sprint backlog. "
        "Return ONLY valid JSON (no markdown) with keys: "
        "description (string), acceptance_criteria (string[]), story_points (int), skill_tags (string[])."
    )
    user = {
        "title": req.title,
        "context": req.context,
    }

    async def gen():
        yield sse_event("meta", {"feature": "ticket-enrichment"})
        text = ""
        async for delta in groq_stream_chat(system=system, user=json.dumps(user, ensure_ascii=False)):
            text += delta
            yield sse_data({"delta": delta})
        yield sse_event("done", {"ok": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_sse_headers())


@router.post("/standup-summarizer/stream")
async def standup_summarizer_stream(req: StandupSummarizerRequest):
    system = (
        "You are an AI Scrum Master. Summarize team standup updates. "
        "Be concise and action-oriented. Highlight blockers and who is blocked. "
        "Return plain text in short sections: Summary, Blockers, Risks, Asks."
    )

    payload = req.model_dump()

    async def gen():
        yield sse_event("meta", {"feature": "standup-summarizer"})
        async for delta in groq_stream_chat(system=system, user=json.dumps(payload, ensure_ascii=False), max_tokens=800):
            yield sse_data({"delta": delta})
        yield sse_event("done", {"ok": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_sse_headers())


@router.post("/retrospective-generator/stream")
async def retrospective_generator_stream(req: RetrospectiveGeneratorRequest):
    system = (
        "You are an AI Scrum Master. Generate a sprint retrospective. "
        "Return ONLY valid JSON (no markdown) with keys: went_well (string[]), "
        "did_not_go_well (string[]), action_items (string[])."
    )

    payload = req.model_dump()

    async def gen():
        yield sse_event("meta", {"feature": "retrospective-generator"})
        async for delta in groq_stream_chat(system=system, user=json.dumps(payload, ensure_ascii=False), max_tokens=900):
            yield sse_data({"delta": delta})
        yield sse_event("done", {"ok": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_sse_headers())


@router.post("/risk-narrator/stream")
async def risk_narrator_stream(req: RiskNarratorRequest):
    system = (
        "You are an AI program manager. Write a plain-English risk briefing. "
        "Audience is stakeholders. Avoid jargon. Keep it short and clear. "
        "Structure: Overall status, Top risks (bullets), Mitigations/Next steps (bullets)."
    )

    payload = req.model_dump()

    async def gen():
        yield sse_event("meta", {"feature": "risk-narrator"})
        async for delta in groq_stream_chat(system=system, user=json.dumps(payload, ensure_ascii=False), max_tokens=700):
            yield sse_data({"delta": delta})
        yield sse_event("done", {"ok": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_sse_headers())
