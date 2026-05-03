from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx


def _groq_base_url() -> str:
    return os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")


def _groq_model() -> str:
    return os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")


def _groq_api_key() -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")
    return api_key


def sse_data(payload: Any) -> str:
    # Always JSON-encode to avoid breaking SSE framing with newlines.
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_event(event: str, payload: Any) -> str:
    return f"event: {event}\n{ sse_data(payload) }"


async def groq_stream_chat(
    *,
    system: Optional[str],
    user: str,
    temperature: float = 0.2,
    max_tokens: int = 900,
) -> AsyncIterator[str]:
    """Stream a chat completion from Groq's OpenAI-compatible API.

    Yields text deltas (not SSE framed). Caller can wrap into SSE events.
    """

    url = f"{_groq_base_url()}/chat/completions"

    messages: List[Dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    headers = {
        "Authorization": f"Bearer {_groq_api_key()}",
        "Content-Type": "application/json",
    }

    body = {
        "model": _groq_model(),
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()

            async for line in resp.aiter_lines():
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue

                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    break

                try:
                    chunk = json.loads(data)
                except Exception:
                    continue

                try:
                    delta = chunk["choices"][0]["delta"].get("content")
                except Exception:
                    delta = None

                if isinstance(delta, str) and delta:
                    yield delta


async def groq_chat(
    *,
    system: Optional[str],
    user: str,
    temperature: float = 0.2,
    max_tokens: int = 900,
) -> str:
    """Request a non-stream chat completion from Groq and return full text."""

    url = f"{_groq_base_url()}/chat/completions"

    messages: List[Dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    headers = {
        "Authorization": f"Bearer {_groq_api_key()}",
        "Content-Type": "application/json",
    }

    body = {
        "model": _groq_model(),
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        payload = resp.json()

    try:
        return str(payload["choices"][0]["message"]["content"] or "")
    except Exception:
        return ""
