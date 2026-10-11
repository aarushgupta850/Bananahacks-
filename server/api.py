"""Optional live generation server for Ghost Lines.

The web app works fully without this server. When it runs, it is reached through a tunnel whose URL
goes in web/public/live.json, and the app calls GET /health (web/src/lib/live.ts, checkLive) before
offering live generation.

Run from the repo root, with server/.venv active:
    uvicorn api:app --app-dir server --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Browsers may only call this API from the deployed site and the local dev server.
# An origin is scheme + host (+ port), so the GitHub Pages entry has no /Bananahacks-/ path.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://aarushgupta850.github.io",
]

app = FastAPI(title="Ghost Lines live API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, bool]:
    """Tells the web app the server is up."""
    return {"ok": True}
