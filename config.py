"""Central configuration for Miki.ai.

Reads from environment variables (loaded from a local .env file) so nothing
secret is ever hard-coded. See .env.example for the full list.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env sitting next to this file, if present.
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _resolve_firebase_key() -> Path:
    """Locate the Firebase service-account key.

    Accepts either a root-level firebase-key.json (preferred/simple name) or the
    admin-SDK key as downloaded from the console into a firebase/ folder.
    """
    root_key = BASE_DIR / "firebase-key.json"
    if root_key.exists():
        return root_key
    firebase_dir = BASE_DIR / "firebase"
    if firebase_dir.is_dir():
        keys = sorted(firebase_dir.glob("*.json"))
        if keys:
            return keys[0]
    return root_key  # non-existent default → drives the "not found" hint


class Config:
    # --- Flask ---
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    DEBUG = os.getenv("FLASK_DEBUG", "true").lower() == "true"

    # --- Gemini ---
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-3.1-flash-lite")
    EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")

    # --- Firebase (auth) ---
    # Public web config (safe to expose to the browser).
    FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "")
    FIREBASE_AUTH_DOMAIN = os.getenv("FIREBASE_AUTH_DOMAIN", "")
    FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
    FIREBASE_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "")
    FIREBASE_MESSAGING_SENDER_ID = os.getenv("FIREBASE_MESSAGING_SENDER_ID", "")
    FIREBASE_APP_ID = os.getenv("FIREBASE_APP_ID", "")
    # Private service-account key for server-side token verification.
    # Accept either a root-level firebase-key.json (preferred/simple name) or the
    # admin-SDK key as downloaded from the console into a firebase/ folder.
    FIREBASE_KEY_PATH = _resolve_firebase_key()

    # --- Storage paths ---
    UPLOAD_DIR = BASE_DIR / "uploads"
    DB_DIR = BASE_DIR / "database"

    # --- RAG tuning ---
    CHUNK_SIZE = 1200          # characters per chunk
    CHUNK_OVERLAP = 200        # characters shared between neighbouring chunks
    TOP_K = 5                  # how many chunks to retrieve per question
    MAX_UPLOAD_MB = 25

    ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx"}

    @classmethod
    def ensure_dirs(cls):
        cls.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        cls.DB_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def is_configured(cls) -> bool:
        return bool(cls.GEMINI_API_KEY)

    @classmethod
    def auth_enabled(cls) -> bool:
        """Auth is enforced only once the Firebase web config is present.
        Before setup the app runs open, so you can never lock yourself out."""
        return bool(cls.FIREBASE_API_KEY and cls.FIREBASE_PROJECT_ID)

    @classmethod
    def firebase_web_config(cls) -> dict:
        return {
            "apiKey": cls.FIREBASE_API_KEY,
            "authDomain": cls.FIREBASE_AUTH_DOMAIN,
            "projectId": cls.FIREBASE_PROJECT_ID,
            "storageBucket": cls.FIREBASE_STORAGE_BUCKET,
            "messagingSenderId": cls.FIREBASE_MESSAGING_SENDER_ID,
            "appId": cls.FIREBASE_APP_ID,
        }
