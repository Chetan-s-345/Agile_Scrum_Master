from __future__ import annotations

import os


def build_groq_llm_config(*, temperature: float = 0.2):
    """AutoGen LLM config for Groq (OpenAI-compatible API).

    AutoGen's OpenAI client accepts a config_list with model + api_key (+ optional base_url).
    """

    api_key = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")
    # Groq exposes an OpenAI-compatible endpoint.
    base_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

    if not api_key:
        raise RuntimeError("Set GROQ_API_KEY (preferred) or OPENAI_API_KEY for AutoGen LLM calls")

    return {
        "temperature": temperature,
        "config_list": [
            {
                "model": model,
                "api_key": api_key,
                "base_url": base_url,
            }
        ],
    }
