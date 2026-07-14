"""Gemini chat wrapper.

Kept deliberately small so the AI provider can be swapped without touching the
rest of the app: only generate_stream() and its return contract matter.
"""
from __future__ import annotations

from typing import Iterator

import google.generativeai as genai

from config import Config

_configured = False


def _ensure_client():
    global _configured
    if not _configured:
        if not Config.GEMINI_API_KEY:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key."
            )
        genai.configure(api_key=Config.GEMINI_API_KEY)
        _configured = True


def generate_stream(system_prompt: str, history: list[dict], user_message: str) -> Iterator[str]:
    """Yield the assistant reply token-by-token.

    history: list of {"role": "user"|"assistant", "content": str}
    """
    _ensure_client()
    model = genai.GenerativeModel(
        Config.CHAT_MODEL,
        system_instruction=system_prompt,
    )

    contents = []
    for turn in history:
        role = "user" if turn["role"] == "user" else "model"
        contents.append({"role": role, "parts": [turn["content"]]})
    contents.append({"role": "user", "parts": [user_message]})

    response = model.generate_content(contents, stream=True)
    for chunk in response:
        if chunk.text:
            yield chunk.text
