"""Embeddings via the Gemini API.

We use Gemini's embedding model so there is nothing heavy to download locally.
Chroma stores whatever vectors we hand it; it never needs its own embedder.
"""
from __future__ import annotations

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


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a batch of document chunks (task_type=retrieval_document)."""
    _ensure_client()
    vectors: list[list[float]] = []
    for text in texts:
        resp = genai.embed_content(
            model=f"models/{Config.EMBED_MODEL}",
            content=text,
            task_type="retrieval_document",
        )
        vectors.append(resp["embedding"])
    return vectors


def embed_query(text: str) -> list[float]:
    """Embed a single user question (task_type=retrieval_query)."""
    _ensure_client()
    resp = genai.embed_content(
        model=f"models/{Config.EMBED_MODEL}",
        content=text,
        task_type="retrieval_query",
    )
    return resp["embedding"]
