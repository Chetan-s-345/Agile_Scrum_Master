from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.groq_features import (
    MeetingSummarizerRequest,
    RetrospectiveGeneratorRequest,
    RiskNarratorRequest,
    StandupSummarizerRequest,
    TicketEnrichmentRequest,
)
from app.services.groq_stream import groq_chat, groq_stream_chat, sse_data, sse_event

router = APIRouter(prefix="/groq", tags=["groq"])


def _sse_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        # Nginx buffering off (harmless elsewhere)
        "X-Accel-Buffering": "no",
    }


def _parse_json_response(raw_text: str) -> dict[str, object]:
    text = str(raw_text or "").strip()
    if not text:
        return {}

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    fenced = text
    if "```" in text:
        parts = text.split("```")
        if len(parts) >= 2:
            fenced = parts[1].replace("json", "", 1).strip()

    try:
        data = json.loads(fenced)
        if isinstance(data, dict):
            return data
    except Exception:
        return {}

    return {}


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


@router.post("/meeting-summarizer")
async def meeting_summarizer(req: MeetingSummarizerRequest):
    system = (
        "You are an expert Scrum Master assistant. "
        "Return ONLY valid JSON with keys: "
        "summary (string), decisions (string), risks (string), action_items (array of objects with id,title,status,source)."
    )

    payload = req.model_dump()
    text = await groq_chat(
        system=system,
        user=json.dumps(payload, ensure_ascii=False),
        max_tokens=1000,
        temperature=0.1,
    )

    parsed = _parse_json_response(text)
    summary = str(parsed.get("summary") or "").strip()
    decisions = str(parsed.get("decisions") or "").strip()
    risks = str(parsed.get("risks") or "").strip()
    items_raw = parsed.get("action_items")

    action_items = []
    if isinstance(items_raw, list):
        for item in items_raw[:20]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            action_items.append(
                {
                    "id": str(item.get("id") or title[:24].replace(" ", "-").lower()),
                    "title": title[:300],
                    "status": str(item.get("status") or "open")[:30],
                    "source": str(item.get("source") or "ai")[:40],
                }
            )

    return {
        "summary": summary,
        "decisions": decisions,
        "risks": risks,
        "action_items": action_items,
        "generator": "groq",
    }
