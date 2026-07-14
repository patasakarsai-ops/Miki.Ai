"""Lightweight persistent vector store (NumPy).

Keeps the whole index in a single .npz + .json pair on disk. Perfect for a
personal RAG app: no native builds, no server, instant startup. The public
interface matches what the rest of the app expects, so this can be swapped for
ChromaDB/pgvector later without touching routes or rag.py.

Vectors come from backend.embeddings (Gemini). Similarity is cosine.
"""
from __future__ import annotations

import json
import uuid

import numpy as np

from config import Config
from backend import embeddings

_VECS_PATH = None
_META_PATH = None

# In-memory index (loaded lazily).
_vectors: np.ndarray | None = None      # shape (N, D), L2-normalised
_metas: list[dict] | None = None        # aligned with _vectors rows


def _paths():
    global _VECS_PATH, _META_PATH
    if _VECS_PATH is None:
        Config.ensure_dirs()
        _VECS_PATH = Config.DB_DIR / "vectors.npy"
        _META_PATH = Config.DB_DIR / "chunks.json"
    return _VECS_PATH, _META_PATH


def _load():
    global _vectors, _metas
    if _vectors is not None:
        return
    vecs_path, meta_path = _paths()
    if vecs_path.exists() and meta_path.exists():
        _vectors = np.load(vecs_path)
        _metas = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        _vectors = np.zeros((0, 0), dtype=np.float32)
        _metas = []


def _save():
    vecs_path, meta_path = _paths()
    np.save(vecs_path, _vectors)
    meta_path.write_text(json.dumps(_metas, ensure_ascii=False), encoding="utf-8")


def _normalise(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def add_chunks(doc_id: str, filename: str, chunks: list[str], owner: str | None = None) -> int:
    """Embed and store all chunks of one document. Returns chunk count.

    `owner` is the Firebase uid of the uploader; every chunk is tagged with it
    so documents stay private to the user who uploaded them.
    """
    if not chunks:
        return 0
    _load()
    global _vectors, _metas

    raw = np.array(embeddings.embed_documents(chunks), dtype=np.float32)
    new_vecs = _normalise(raw)

    if _vectors.size == 0:
        _vectors = new_vecs
    else:
        _vectors = np.vstack([_vectors, new_vecs])

    for i, text in enumerate(chunks):
        _metas.append({
            "doc_id": doc_id, "filename": filename, "chunk": i, "text": text,
            "owner": owner,
        })
    _save()
    return len(chunks)


def query(question: str, top_k: int = Config.TOP_K, owner: str | None = None) -> list[dict]:
    """Return the most relevant chunks for a question (cosine similarity).

    Only chunks owned by `owner` are considered, so retrieval never leaks one
    user's documents into another user's chat.
    """
    _load()
    if _vectors.size == 0:
        return []
    q = np.array(embeddings.embed_query(question), dtype=np.float32)
    q = q / (np.linalg.norm(q) or 1.0)

    scores = _vectors @ q                      # cosine, since all are normalised

    # Restrict to this owner's rows before ranking.
    owned_idx = [i for i, m in enumerate(_metas) if m.get("owner") == owner]
    if not owned_idx:
        return []
    owned_idx.sort(key=lambda i: -scores[i])
    top_idx = owned_idx[:top_k]

    hits = []
    for idx in top_idx:
        meta = _metas[int(idx)]
        hits.append({
            "text": meta["text"],
            "filename": meta.get("filename", "unknown"),
            "chunk": meta.get("chunk", 0),
            "score": round(float(scores[idx]), 3),
        })
    return hits


def list_documents(owner: str | None = None) -> list[dict]:
    """Group stored chunks by source document, restricted to `owner`."""
    _load()
    docs: dict[str, dict] = {}
    for meta in _metas:
        if meta.get("owner") != owner:
            continue
        did = meta["doc_id"]
        entry = docs.setdefault(
            did, {"doc_id": did, "filename": meta["filename"], "chunks": 0}
        )
        entry["chunks"] += 1
    return list(docs.values())


def delete_document(doc_id: str, owner: str | None = None) -> bool:
    """Delete a document, but only if it belongs to `owner`.

    Returns True if something was deleted, False if the doc wasn't found for
    this owner (so one user can't delete another's document).
    """
    _load()
    global _vectors, _metas
    owns = any(m["doc_id"] == doc_id and m.get("owner") == owner for m in _metas)
    if not owns:
        return False
    keep = [i for i, m in enumerate(_metas) if m["doc_id"] != doc_id]
    _metas = [_metas[i] for i in keep]
    _vectors = _vectors[keep] if keep else np.zeros((0, 0), dtype=np.float32)
    _save()
    return True


def new_doc_id() -> str:
    return uuid.uuid4().hex[:12]
