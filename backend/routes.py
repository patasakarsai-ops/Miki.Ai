"""HTTP API for Miki.ai — chat streaming, document upload & management."""
from __future__ import annotations

import json
from pathlib import Path

from flask import Blueprint, Response, jsonify, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

from config import Config
from backend import ingest, rag, vectorstore
from backend.auth import current_user, login_required

api = Blueprint("api", __name__)


def _owner_id() -> str:
    """Identify who owns documents for the current request.

    When auth is enabled this is the signed-in user's Firebase uid, so each
    user only ever sees their own uploads. When auth is disabled (open mode
    before Firebase setup) everything shares a single local owner.
    """
    user = current_user()
    if user and user.get("uid"):
        return user["uid"]
    return "__local__"


@api.route("/")
def index():
    # Gate the app behind login once Firebase is configured.
    if Config.auth_enabled() and not current_user():
        return redirect(url_for("api.login_page"))
    return render_template(
        "index.html",
        configured=Config.is_configured(),
        auth_enabled=Config.auth_enabled(),
        firebase_config=Config.firebase_web_config(),
        user=current_user(),
    )


@api.route("/login")
def login_page():
    if not Config.auth_enabled():
        return redirect(url_for("api.index"))  # nothing to log into yet
    if current_user():
        return redirect(url_for("api.index"))
    return render_template(
        "login.html",
        firebase_config=Config.firebase_web_config(),
    )


@api.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "configured": Config.is_configured(),
        "documents": len(vectorstore.list_documents()),
    })


@api.route("/api/chat", methods=["POST"])
@login_required
def chat():
    """Server-Sent Events stream of the RAG answer."""
    data = request.get_json(force=True)
    question = (data.get("message") or "").strip()
    history = data.get("history") or []
    if not question:
        return jsonify({"error": "Empty message"}), 400

    owner = _owner_id()

    def event_stream():
        try:
            for event in rag.answer(question, history, owner=owner):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # surface errors to the client cleanly
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api.route("/api/documents", methods=["GET"])
@login_required
def documents():
    return jsonify({"documents": vectorstore.list_documents(owner=_owner_id())})


@api.route("/api/documents/<doc_id>", methods=["DELETE"])
@login_required
def delete_document(doc_id):
    deleted = vectorstore.delete_document(doc_id, owner=_owner_id())
    if not deleted:
        return jsonify({"error": "Document not found"}), 404
    return jsonify({"ok": True})


@api.route("/api/upload", methods=["POST"])
@login_required
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    filename = secure_filename(file.filename)
    ext = Path(filename).suffix.lower()
    if ext not in Config.ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported type {ext}"}), 400

    Config.ensure_dirs()
    dest = Config.UPLOAD_DIR / filename
    file.save(dest)

    try:
        text = ingest.extract_text(dest)
        chunks = ingest.chunk_text(text)
        if not chunks:
            return jsonify({"error": "No readable text found in file"}), 400
        doc_id = vectorstore.new_doc_id()
        count = vectorstore.add_chunks(doc_id, filename, chunks, owner=_owner_id())
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({"ok": True, "doc_id": doc_id, "filename": filename, "chunks": count})
