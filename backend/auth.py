"""Firebase authentication — server-side token verification + session.

Flow:
  1. The browser signs in with the Firebase JS SDK (email/password or Google)
     and receives a Firebase ID token.
  2. It POSTs that token to /api/auth/session.
  3. Here we verify it with the Firebase Admin SDK (using firebase-key.json)
     and store the user in a signed Flask session cookie.
  4. Protected routes check the session via @login_required.

If Firebase is not configured yet (no web config), auth is disabled and the app
runs open — so you can never lock yourself out before finishing setup.
"""
from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from config import Config

auth_bp = Blueprint("auth", __name__)

_admin_ready = False
_admin_error = ""


def _ensure_admin() -> bool:
    """Lazily initialise the Firebase Admin SDK with the service account."""
    global _admin_ready, _admin_error
    if _admin_ready:
        return True
    if not Config.FIREBASE_KEY_PATH.exists():
        _admin_error = (
            "firebase-key.json not found. Download a service-account key from "
            "Firebase Console → Project settings → Service accounts and place it "
            "in the project root."
        )
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            cred = credentials.Certificate(str(Config.FIREBASE_KEY_PATH))
            firebase_admin.initialize_app(cred)
        _admin_ready = True
        return True
    except Exception as exc:  # bad key file, etc.
        _admin_error = f"Firebase Admin init failed: {exc}"
        return False


def current_user() -> dict | None:
    if "uid" in session:
        return {
            "uid": session["uid"],
            "email": session.get("email", ""),
            "name": session.get("name", ""),
            "picture": session.get("picture", ""),
        }
    return None


def login_required(fn):
    """Reject unauthenticated API calls — but only when auth is enabled."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if Config.auth_enabled() and "uid" not in session:
            return jsonify({"error": "Authentication required", "auth": True}), 401
        return fn(*args, **kwargs)
    return wrapper


@auth_bp.post("/api/auth/session")
def create_session():
    if not _ensure_admin():
        return jsonify({"error": _admin_error}), 503

    from firebase_admin import auth as fb_auth

    data = request.get_json(force=True) or {}
    token = data.get("idToken")
    if not token:
        return jsonify({"error": "Missing idToken"}), 400

    try:
        # Allow a small clock skew (up to 60s) so a slightly fast/slow local
        # clock doesn't reject an otherwise-valid token ("used too early").
        decoded = fb_auth.verify_id_token(token, clock_skew_seconds=60)
    except Exception as exc:
        return jsonify({"error": f"Invalid or expired token ({exc})"}), 401

    email = decoded.get("email", "")
    session.permanent = True
    session["uid"] = decoded["uid"]
    session["email"] = email
    session["name"] = decoded.get("name") or (email.split("@")[0] if email else "User")
    session["picture"] = decoded.get("picture", "")
    return jsonify({"ok": True, "user": current_user()})


@auth_bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@auth_bp.get("/api/auth/me")
def me():
    return jsonify({"user": current_user(), "auth_enabled": Config.auth_enabled()})
