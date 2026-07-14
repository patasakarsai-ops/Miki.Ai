# Miki.ai ✦

A professional, **RAG-based AI assistant** with a clean, Gemini-inspired interface.
Upload your documents (PDF, DOCX, TXT, MD) and chat with them — answers are grounded
in your files and cite their sources.

![stack](https://img.shields.io/badge/Flask-3-black) ![llm](https://img.shields.io/badge/Gemini-API-blue) ![vectors](https://img.shields.io/badge/ChromaDB-vectors-brightgreen)

---

## ✨ Features

- **Gemini-style UI** — spacious layout, gradient branding, light/dark theme, responsive.
- **Streaming answers** — tokens appear live via Server-Sent Events.
- **Retrieval-Augmented Generation** — your docs are chunked, embedded (Gemini
  `text-embedding-004`) and stored in ChromaDB; the most relevant chunks are fed to the model.
- **Source citations** — each answer shows which documents it drew from.
- **Drag & drop upload** and a knowledge-base panel to manage indexed documents.
- **Clean, swappable architecture** — the AI provider lives behind one small module.

---

## 🏗 Project structure

```
Miki.ai/
├── app.py                  # Flask entry point (create_app)
├── config.py               # central config (reads .env)
├── requirements.txt
├── .env.example            # copy to .env and add your key
├── backend/
│   ├── embeddings.py       # Gemini embeddings
│   ├── vectorstore.py      # ChromaDB persistence + retrieval
│   ├── ingest.py           # extract text + chunking (PDF/DOCX/TXT/MD)
│   ├── llm.py              # Gemini chat (streaming) — swap provider here
│   ├── rag.py              # retrieve → build prompt → stream answer
│   └── routes.py           # HTTP API (chat, upload, documents)
├── templates/index.html    # the single-page UI
├── static/
│   ├── css/style.css       # design system
│   └── js/app.js           # streaming, upload, markdown, theme
├── uploads/                # your uploaded files (gitignored)
├── database/               # ChromaDB store (gitignored)
└── models/                 # reserved for local models (gitignored)
```

---

## 🚀 Getting started

### 1. Create & activate a virtual environment
```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Add your Gemini API key
Get a free key at <https://aistudio.google.com/app/apikey>, then:
```bash
cp .env.example .env      # Windows: copy .env.example .env
```
Open `.env` and set `GEMINI_API_KEY=...`

### 4. Run
```bash
python app.py
```
Open <http://127.0.0.1:5000>.

---

## 🧠 How the RAG pipeline works

1. **Upload** → `ingest.extract_text()` reads the file and `chunk_text()` splits it
   into overlapping ~1,200-char chunks.
2. **Index** → each chunk is embedded and stored in ChromaDB with its filename.
3. **Ask** → your question is embedded and the top-K most similar chunks are retrieved.
4. **Answer** → those chunks are injected into the prompt; Gemini streams a grounded,
   cited reply.

Tune chunk size, overlap and `TOP_K` in [`config.py`](config.py).

---

## 🔄 Swapping the AI provider

Everything provider-specific lives in [`backend/llm.py`](backend/llm.py) and
[`backend/embeddings.py`](backend/embeddings.py). To use Claude or another model,
reimplement `generate_stream()` (and the embedding functions) — the rest of the app
is untouched.

---

## 📝 Notes

- Chat history is kept in the browser session for now (no database/auth yet).
- Firebase auth is intentionally deferred — the structure leaves room for it.
