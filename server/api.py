"""Optional live generation server for Ghost Lines: builds a lesson from a short prompt or a photo, live.

The web app works fully without this server. When it runs, it is reached through a tunnel whose URL goes in
web/public/live.json, and the app (web/src/lib/live.ts) calls GET /health before offering live generation.

Run from the repo root (see server/LIVE.md):
    powershell -ExecutionPolicy Bypass -File server\\run_live.ps1        # warms up the models first
    uvicorn api:app --app-dir server --port 8000                         # or directly, without warm-up

Endpoints:
- GET /health -> {"ok": true, "gpu": "<name>", "busy": <bool>}
- POST /generate {prompt?, imageBase64?, difficulty} -> a Pack whose images are data: URLs.
  One job at a time (busy: 503). Answers within 23 s or gives up (504), because the web app stops
  waiting at 25 s. Bad input: 400, with a message. No clean drawing: 422.

Safety: prompts are 40 characters or less, letters, numbers and spaces only, checked against a blocklist,
and always wrapped in the line-art prompt. Photos are 5 MB or less, JPEG or PNG only. Requests are logged,
but photos are never stored.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import logging
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Browsers may only call this API from the deployed site and the local dev server.
# An origin is scheme + host (+ port), so the GitHub Pages entry has no /Bananahacks-/ path.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://aarushgupta850.github.io",
]
MAX_PROMPT_CHARS = 40
PROMPT_PATTERN = re.compile(r"[A-Za-z0-9 ]+")  # letters, numbers and spaces only
# Words that never belong in a drawing lesson for beginners (whole words, lowercase). Add to it as needed.
BLOCKLIST = {
    "nude", "naked", "nsfw", "sex", "sexy", "porn", "breasts", "kill", "killing", "murder", "blood", "bloody",
    "gore", "corpse", "dead", "gun", "guns", "rifle", "knife", "weapon", "bomb", "explosion", "drug", "drugs",
    "cocaine", "suicide", "nazi", "swastika", "terrorist", "hitler", "hate", "racist",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
TIMEOUT_S = 23  # the web app (web/src/lib/live.ts) gives up after 25 s, so answer before that
LIVE_CANDIDATES = 3  # one fewer draft than offline packs: about 15 s of generation instead of 20

log = logging.getLogger("ghostlines.live")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_lock = asyncio.Lock()  # one job at a time: the GPU can only build one pack at once
_gpu_name: str | None = None


class InputError(ValueError):
    """The request is not allowed (shown to the user as the reason)."""


class GenerateRequest(BaseModel):
    prompt: str | None = None
    imageBase64: str | None = None
    difficulty: Literal["simple", "medium", "detailed"] = "medium"


def check_prompt(prompt: str) -> str:
    """The cleaned prompt, or InputError saying why it's not allowed."""
    prompt = " ".join(prompt.split())
    if not prompt:
        raise InputError("Type what you'd like to draw.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise InputError(f"Keep it to {MAX_PROMPT_CHARS} characters or less.")
    if not PROMPT_PATTERN.fullmatch(prompt):
        raise InputError("Use only letters, numbers and spaces.")
    if any(word in BLOCKLIST for word in prompt.lower().split()):
        raise InputError("Let's draw something else.")
    return prompt


def decode_image(data: str) -> bytes:
    """The photo's bytes, or InputError. Accepts plain base64 or a data: URL. JPEG or PNG, 5 MB or less."""
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    if len(data) > MAX_IMAGE_BYTES * 4 // 3 + 4:  # base64 is 4/3 the size: check before decoding
        raise InputError("The photo must be 5 MB or less.")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise InputError("The photo couldn't be read.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise InputError("The photo must be 5 MB or less.")
    if not (raw.startswith(b"\xff\xd8\xff") or raw.startswith(b"\x89PNG\r\n\x1a\n")):
        raise InputError("The photo must be a JPEG or PNG.")
    return raw


def gpu_name() -> str:
    global _gpu_name
    if _gpu_name is None:
        try:
            import torch

            _gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none"
        except Exception:  # noqa: BLE001 - health must never fail
            _gpu_name = "none"
    return _gpu_name


def with_data_urls(pack: dict, assets: dict[str, bytes]) -> dict:
    """Replaces every asset path in the pack (target, thumb, pipeline images) with a data: URL, so the
    browser gets the whole lesson in one response."""
    def url(path: str) -> str:
        mime = "image/webp" if path.endswith(".webp") else "image/png"
        return f"data:{mime};base64,{base64.b64encode(assets[path]).decode()}"

    pack = {**pack, "target": url(pack["target"]), "thumb": url(pack["thumb"])}
    stages = []
    for stage in pack["pipeline"]:
        stage = dict(stage)
        if "image" in stage:
            stage["image"] = url(stage["image"])
        if "images" in stage:
            stage["images"] = [url(p) for p in stage["images"]]
        stages.append(stage)
    pack["pipeline"] = stages
    return pack


def build_live_pack(prompt: str | None, image: bytes | None, difficulty: str) -> dict:
    """Builds a pack with the same pipeline as build_pack.py, in memory. Needs the GPU."""
    from PIL import Image

    from build_pack import make_pack
    from pipeline import models

    models.setup_hf_env()  # before the Hugging Face libraries load
    from pipeline import generate as gen
    from pipeline.parts import detect_parts, subject_slug

    words = prompt or "a simple object"
    slug = re.sub(r"[^a-z0-9-]", "", subject_slug(words)) or "drawing"
    photo = Image.open(io.BytesIO(image)) if image else None
    if photo is not None:
        def generate(seed):
            return gen.from_photo(photo, words, difficulty, n=LIVE_CANDIDATES, seed=seed)
    else:
        def generate(seed):
            return gen.from_prompt(words, difficulty, n=LIVE_CANDIDATES, seed=seed)

    pack, assets = make_pack(
        pack_id=f"live-{slug}-{difficulty}", subject=slug, title=words[:1].upper() + words[1:], difficulty=difficulty,
        source_kind="photo" if photo is not None else "prompt", prompt=prompt, subject_words=words,
        seed=secrets.randbelow(100_000),  # a new drawing every time
        generate=generate, detect=lambda drawing: detect_parts(drawing, words), retries=0, photo=photo,
        log=log.info,
    )
    return with_data_urls(pack, assets)


# The function that builds a pack. Tests swap in a fake, so they need no GPU.
BUILD = build_live_pack


def warm_up() -> None:
    """Loads every model and builds one throwaway pack, so the first real request is fast."""
    start = time.perf_counter()
    BUILD("a cat", None, "medium")
    log.info("warm-up done in %.1f s", time.perf_counter() - start)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.environ.get("GHOSTLINES_WARMUP") == "1":  # set by run_live.ps1
        async with _lock:  # report busy while warming up
            await asyncio.to_thread(warm_up)
    yield


app = FastAPI(title="Ghost Lines live API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict:
    """Tells the web app the server is up, which GPU it has, and whether it's busy."""
    return {"ok": True, "gpu": gpu_name(), "busy": _lock.locked()}


@app.post("/generate")
async def generate(request: GenerateRequest):
    start = time.perf_counter()
    kind = "photo" if request.imageBase64 else "prompt"
    try:
        if not request.prompt and not request.imageBase64:
            raise InputError("Type something to draw, or add a photo.")
        prompt = check_prompt(request.prompt) if request.prompt else None
        image = decode_image(request.imageBase64) if request.imageBase64 else None
    except InputError as error:
        log.info("generate %s rejected: %s", kind, error)
        return JSONResponse({"error": str(error)}, status_code=400)
    if _lock.locked():
        log.info("generate %s %r: busy", kind, prompt)
        return JSONResponse({"error": "busy"}, status_code=503)

    from build_pack import NoCleanCandidate

    await _lock.acquire()
    # The build runs in a worker thread. The lock is released when the build really ends, even if we stop
    # waiting for it, so a timed-out build can't overlap the next one on the GPU.
    task = asyncio.ensure_future(asyncio.to_thread(BUILD, prompt, image, request.difficulty))

    def finished(t: asyncio.Future) -> None:
        _lock.release()
        if not t.cancelled():
            t.exception()  # mark any error as seen; it was already handled or logged

    task.add_done_callback(finished)
    try:
        pack = await asyncio.wait_for(asyncio.shield(task), TIMEOUT_S)
    except asyncio.TimeoutError:
        log.info("generate %s %r (%s): timed out after %d s", kind, prompt, request.difficulty, TIMEOUT_S)
        return JSONResponse({"error": "timeout"}, status_code=504)
    except NoCleanCandidate as error:
        log.info("generate %s %r: no clean drawing (%s)", kind, prompt, error)
        return JSONResponse({"error": "Couldn't make a clean drawing of that. Try a simpler subject."}, status_code=422)
    except Exception:  # noqa: BLE001 - log it, tell the app it failed
        log.exception("generate %s %r failed", kind, prompt)
        return JSONResponse({"error": "failed"}, status_code=500)
    log.info("generate %s %r (%s, %d image bytes): ok in %.1f s", kind, prompt, request.difficulty,
             len(image or b""), time.perf_counter() - start)
    return pack
