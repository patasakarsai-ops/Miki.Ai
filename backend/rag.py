"""RAG orchestration: retrieve context, build the prompt, stream the answer."""
from __future__ import annotations

from typing import Iterator

from config import Config
from backend import llm, vectorstore

SYSTEM_PROMPT = """You are Miki, a helpful and precise AI assistant.

When context from the user's documents is provided, ground your answer in it and \
cite the source filename in square brackets, e.g. [report.pdf]. If the context does \
not contain the answer, say so briefly and then answer from general knowledge, \
making clear which part is not from the documents.

Be clear, well-structured, and concise. Use Markdown for formatting."""


def _build_context_block(hits: list[dict]) -> str:
    parts = []
    for i, h in enumerate(hits, 1):
        parts.append(f"[Source {i}: {h['filename']}]\n{h['text']}")
    return "\n\n---\n\n".join(parts)


def answer(question: str, history: list[dict], owner: str | None = None) -> Iterator[dict]:
    """Stream a RAG answer.

    Only documents owned by `owner` are retrieved as context.

    Yields dicts:
      {"type": "sources", "sources": [...]}  (once, first)
      {"type": "token", "text": "..."}       (many)
      {"type": "done"}                        (once, last)
    """
    hits = vectorstore.query(question, top_k=Config.TOP_K, owner=owner)

    # De-duplicate source filenames for the UI chips.
    seen, sources = set(), []
    for h in hits:
        if h["filename"] not in seen:
            seen.add(h["filename"])
            sources.append({"filename": h["filename"], "score": h["score"]})
    yield {"type": "sources", "sources": sources}

    if hits:
        context = _build_context_block(hits)
        user_message = (
            f"Use the following context from my documents to answer.\n\n"
            f"CONTEXT:\n{context}\n\nQUESTION: {question}"
        )
    else:
        user_message = question

    for token in llm.generate_stream(SYSTEM_PROMPT, history, user_message):
        yield {"type": "token", "text": token}

    yield {"type": "done"}
