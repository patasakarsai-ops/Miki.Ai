"""Document ingestion: read a file, extract text, split into chunks."""
from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader
from docx import Document as DocxDocument

from config import Config


def extract_text(path: Path) -> str:
    """Extract raw text from a supported file type."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        reader = PdfReader(str(path))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    if ext == ".docx":
        doc = DocxDocument(str(path))
        return "\n".join(p.text for p in doc.paragraphs)
    if ext in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"Unsupported file type: {ext}")


def chunk_text(
    text: str,
    size: int = Config.CHUNK_SIZE,
    overlap: int = Config.CHUNK_OVERLAP,
) -> list[str]:
    """Split text into overlapping chunks, preferring paragraph boundaries."""
    text = _normalise(text)
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buffer = ""

    for para in paragraphs:
        if len(buffer) + len(para) + 2 <= size:
            buffer = f"{buffer}\n\n{para}".strip()
        else:
            if buffer:
                chunks.append(buffer)
            # Paragraph itself may exceed size -> hard-split it.
            if len(para) > size:
                chunks.extend(_hard_split(para, size, overlap))
                buffer = ""
            else:
                buffer = para
    if buffer:
        chunks.append(buffer)

    return _apply_overlap(chunks, overlap)


def _normalise(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    return "\n".join(lines).strip()


def _hard_split(text: str, size: int, overlap: int) -> list[str]:
    step = max(size - overlap, 1)
    return [text[i : i + size] for i in range(0, len(text), step)]


def _apply_overlap(chunks: list[str], overlap: int) -> list[str]:
    """Prepend a tail of the previous chunk to preserve context across cuts."""
    if overlap <= 0 or len(chunks) <= 1:
        return chunks
    out = [chunks[0]]
    for i in range(1, len(chunks)):
        tail = chunks[i - 1][-overlap:]
        out.append(f"{tail} {chunks[i]}")
    return out
