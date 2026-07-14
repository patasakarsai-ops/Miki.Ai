"""Miki.ai — a RAG-based AI assistant (Flask entry point)."""
from datetime import timedelta

from flask import Flask, redirect, request

from config import Config
from backend.routes import api
from backend.auth import auth_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = Config.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = Config.MAX_UPLOAD_MB * 1024 * 1024
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
    Config.ensure_dirs()

    @app.before_request
    def force_localhost_host():
        """Firebase authorizes 'localhost' by default but not '127.0.0.1',
        which breaks Google OAuth popups/redirects. Since the dev server on
        127.0.0.1 is reachable as localhost too, transparently redirect so the
        browser's origin is an authorized domain — no console change needed."""
        host = request.host.split(":")[0]
        if host == "127.0.0.1":
            new_url = request.url.replace("127.0.0.1", "localhost", 1)
            return redirect(new_url, code=307)

    app.register_blueprint(api)
    app.register_blueprint(auth_bp)
    return app


app = create_app()

if __name__ == "__main__":
    print("  Miki.ai running at  http://localhost:5000")
    if not Config.is_configured():
        print("  !  GEMINI_API_KEY not set - copy .env.example to .env and add your key.")
    app.run(host="127.0.0.1", port=5000, debug=Config.DEBUG, threaded=True)
