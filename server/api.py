"""Optional live generation server for Ghost Lines: builds a lesson from a short prompt or a photo, live.

The web app works fully without this server. When it runs, it is reached through a tunnel whose URL goes in
web/public/live.json, and the app (web/src/lib/live.ts) calls GET /health before offering live generation.

Run from the repo root (see server/LIVE.md):
    powershell -ExecutionPolicy Bypass -File server\\run_live.ps1        # warms up the models first
    uvicorn api:app --app-dir server --port 8000                         # or directly, without warm-up

Endpoints:
- GET /health -> {"ok": true, "gpu": "<name>", "busy": <bool>}
- POST /generate {prompt?, imageBase64?, difficulty} -> a Pack whose images are data: URLs.
- POST /regenerate {prompt, canvasBase64, difficulty} -> "Happy accidents" (behind ?happy=1 in the app): a new
  Pack whose drawing is redrawn around what the user has drawn so far, without the lines they already drew.
  One job at a time (busy: 503). Answers within 35 s or gives up (504), because the web app stops
  waiting at 38 s. Bad input: 400, with a message. No clean drawing: 422.

Safety (see pipeline/safety.py): prompts are 80 characters or less, letters, numbers, spaces and simple
punctuation, checked against a blocklist that also catches disguised words, and always wrapped in the line-art
prompt. Photos are 15 MB or less, JPEG, PNG or WebP, and both the photo and the chosen drawing are checked for
nudity and weapons with OWLv2. Requests are logged, but photos are never stored.
Any allowed prompt gets a lesson: if no drawing fits the stroke limit, the cleanest one is simplified. A photo is
named by OWLv2 ("a mug") and drawn from that name; a photo it can't name gets a hint instead (422).
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
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline import safety

# Browsers may only call this API from the deployed site and the local dev server.
# An origin is scheme + host (+ port), so the GitHub Pages entry has no /Bananahacks-/ path.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://aarushgupta850.github.io",
]
MAX_PROMPT_CHARS = 80  # the same as the input box in SubjectPicker.tsx
PROMPT_PATTERN = re.compile(r"[A-Za-z0-9 '\-,.!?&]+")  # letters, numbers, spaces and simple punctuation
MAX_IMAGE_BYTES = 15 * 1024 * 1024  # phone photos are often 3 to 10 MB
MAX_PHOTO_SIDE = 1536  # bigger photos are scaled down first: OWLv2 looks at them at 960 x 960 anyway
# A lesson takes about 18-24 s on the RTX 4060 Ti (more when the PC is short of memory). The web app
# (web/src/lib/live.ts) gives up after 38 s, so answer before that.
TIMEOUT_S = 35
# The most strokes a live lesson keeps, by the difficulty asked for. The AI draws busy pictures whatever it is
# asked (a "simple" cat had 51 strokes), so a simple lesson keeps only the drawing's 25 longest strokes.
LIVE_STROKE_LIMITS = {"simple": 25, "medium": 50, "detailed": 60}
LIVE_CANDIDATES = 3  # one fewer draft than offline packs: about 15 s of generation instead of 20

log = logging.getLogger("ghostlines.live")
log.setLevel(logging.INFO)  # whatever level the root logger has, our request lines are always written
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# run_live.ps1 also keeps a log file (GHOSTLINES_LOG=1), so we can see afterwards who used the live server and how
# it went: the window only shows its last few screens. server/out is never committed.
LOG_FILE = Path(__file__).resolve().parent / "out" / "live.log"
_lock = asyncio.Lock()  # one job at a time: the GPU can only build one pack at once
# When the current GPU job (or the warm-up) took the lock, by time.monotonic(); None when no job is running.
_job_started: float | None = None
# A build that holds the lock this long is hung (a real one takes under TIMEOUT_S; the warm-up about 30 s), e.g.
# a CUDA call that never returns while the PC is short of memory. A Python thread can't be stopped, and while it
# holds the lock every visitor gets "busy" forever, so the server exits instead and run_live.ps1 starts it again.
STUCK_S = 180


def _exit_for_restart() -> None:
    os._exit(3)  # a separate function so tests can replace it


def check_not_stuck() -> None:
    """Exits the server (run_live.ps1 restarts it) when a GPU job has held the lock for more than STUCK_S."""
    if _lock.locked() and _job_started is not None and time.monotonic() - _job_started > STUCK_S:
        log.error("a GPU job has held the lock for %.0f s: it is stuck. Restarting the server.",
                  time.monotonic() - _job_started)
        _exit_for_restart()


def _mark_job(started: bool) -> None:
    global _job_started
    _job_started = time.monotonic() if started else None
_gpu_name: str | None = None


REFUSED = "Let's draw something else."


class InputError(ValueError):
    """The request is not allowed (shown to the user as the reason)."""


class GenerateRequest(BaseModel):
    prompt: str | None = None
    imageBase64: str | None = None
    difficulty: Literal["simple", "medium", "detailed"] = "medium"


class RegenerateRequest(BaseModel):
    prompt: str                # the lesson's subject, e.g. "a fox"
    canvasBase64: str          # PNG of the user's canvas so far, 768 x 768
    difficulty: Literal["simple", "medium", "detailed"] = "medium"


COVERED_PX = 10      # a plan stroke within this distance of the user's ink...
COVERED_SHARE = 0.8  # ...for this share of its points is already drawn, so the new plan drops it


def drop_covered(pack: dict, canvas_ink) -> dict:
    """The pack without the strokes the user has already drawn (and without construction shapes: the user is
    past that stage). canvas_ink is a 768 x 768 boolean array, True where the user drew. Empty steps go too."""
    import numpy as np
    from scipy import ndimage

    from pipeline import schema

    distance = ndimage.distance_transform_edt(~canvas_ink)  # px to the nearest user ink

    def covered(points) -> bool:
        near = [distance[min(max(int(y), 0), 767), min(max(int(x), 0), 767)] <= COVERED_PX for x, y in points]
        return np.mean(near) >= COVERED_SHARE

    keep = [s for s in pack["strokes"] if s["tier"] != "construction" and not covered(s["points"])]
    kept_ids = {s["id"] for s in keep}
    steps = [{**step, "strokeIds": [i for i in step["strokeIds"] if i in kept_ids]} for step in pack["steps"]]
    out = {**pack, "strokes": keep, "steps": [st for st in steps if st["strokeIds"]]}
    schema.Pack.model_validate(out)
    return out


def check_prompt(prompt: str) -> str:
    """The cleaned prompt, or InputError saying why it's not allowed."""
    prompt = " ".join(prompt.split())
    if not prompt:
        raise InputError("Type what you'd like to draw.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise InputError(f"Keep it to {MAX_PROMPT_CHARS} characters or less.")
    if not PROMPT_PATTERN.fullmatch(prompt):
        raise InputError("Use letters, numbers, spaces and simple punctuation only.")
    if safety.blocked_prompt(prompt):
        raise InputError(REFUSED)
    return prompt


def decode_image(data: str) -> bytes:
    """The photo's bytes, or InputError. Accepts plain base64 or a data: URL. JPEG, PNG or WebP, 15 MB or less."""
    limit_mb = MAX_IMAGE_BYTES // (1024 * 1024)
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    if len(data) > MAX_IMAGE_BYTES * 4 // 3 + 4:  # base64 is 4/3 the size: check before decoding
        raise InputError(f"The photo must be {limit_mb} MB or less.")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise InputError("The photo couldn't be read.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise InputError(f"The photo must be {limit_mb} MB or less.")
    is_webp = raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if not (raw.startswith(b"\xff\xd8\xff") or raw.startswith(b"\x89PNG\r\n\x1a\n") or is_webp):
        raise InputError("The photo must be a JPEG, PNG or WebP (on an iPhone, use Most Compatible photos).")
    try:
        from PIL import Image

        Image.open(io.BytesIO(raw)).verify()  # a truncated or broken file fails here, not deep in the pipeline
    except Exception:  # noqa: BLE001 - any decoding problem means the same thing to the user
        raise InputError("The photo couldn't be read.") from None
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


class UnknownPhoto(Exception):
    """OWLv2 couldn't tell what the photo shows, so there is nothing to draw."""


def build_live_pack(prompt: str | None, image: bytes | None, difficulty: str) -> dict:
    """Builds a pack with the same pipeline as build_pack.py, in memory. Needs the GPU.

    A photo is not redrawn: redraws of real photos traced into hundreds of broken strokes, so nearly every photo
    was refused. Instead OWLv2 names what the photo shows (gen.name_subject, e.g. "a mug") and the lesson is drawn
    from that name, exactly like a typed subject. A name typed with the photo is used as it is."""
    from PIL import Image

    from build_pack import make_pack
    from pipeline import models

    models.setup_hf_env()  # before the Hugging Face libraries load
    from pipeline import generate as gen
    from pipeline.parts import detect_parts, subject_slug

    photo = Image.open(io.BytesIO(image)) if image else None
    note = None  # how the photo became a subject, for the "How this lesson was made" panel
    if photo is not None:
        from PIL import ImageOps

        photo = ImageOps.exif_transpose(photo).convert("RGB")  # phone photos the right way up
        photo.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))  # a 12-megapixel photo slows every step down
        safety.check_picture(photo)  # before anything is done with it
        if prompt:
            note = f"You named your photo \"{prompt}\", and the AI drew that."
        else:
            prompt = gen.name_subject(photo)
            if prompt is None:
                raise UnknownPhoto("OWLv2 matched none of the photo subjects well enough")
            log.info("  photo recognized as %r", prompt)
            note = f"OWLv2 recognized your photo as {prompt}, and the AI drew {prompt} from scratch."
    words = prompt
    slug = re.sub(r"[^a-z0-9-]", "", subject_slug(words)) or "drawing"
    pack, assets = make_pack(
        pack_id=f"live-{slug}-{difficulty}", subject=slug, title=words[:1].upper() + words[1:], difficulty=difficulty,
        source_kind="photo" if photo is not None else "prompt", prompt=words, subject_words=words,
        seed=secrets.randbelow(100_000),  # a new drawing every time
        generate=lambda seed: gen.from_prompt(words, difficulty, n=LIVE_CANDIDATES, seed=seed),
        detect=lambda drawing: detect_parts(drawing, words), retries=0, photo=photo,
        log=log.info, check_drawing=safety.check_picture,
        rate=True,  # label the lesson by how hard the drawing came out, not by what was asked for
        limit=LIVE_STROKE_LIMITS[difficulty],
        always=True,  # every allowed subject gets a lesson: a busy drawing is simplified to the stroke limit
        source_note=note,
    )
    return with_data_urls(pack, assets)


def rebuild_live_pack(prompt: str, canvas: bytes, difficulty: str) -> dict:
    """Happy accidents: a new pack whose drawing follows the user's canvas so far. Needs the GPU."""
    import numpy as np
    from PIL import Image

    from build_pack import make_pack
    from pipeline import models

    models.setup_hf_env()
    from pipeline import generate as gen
    from pipeline.parts import detect_parts, subject_slug

    drawing = Image.open(io.BytesIO(canvas))
    safety.check_picture(drawing.convert("RGB"))
    ink = np.asarray(drawing.convert("RGBA").resize((768, 768)))
    canvas_ink = (ink[..., 3] > 32) & (ink[..., :3].mean(axis=2) < 160)  # dark, opaque pixels

    slug = re.sub(r"[^a-z0-9-]", "", subject_slug(prompt)) or "drawing"
    pack, assets = make_pack(
        pack_id=f"live-{slug}-{difficulty}", subject=slug, title=prompt[:1].upper() + prompt[1:], difficulty=difficulty,
        source_kind="prompt", prompt=prompt, subject_words=prompt, seed=secrets.randbelow(100_000),
        generate=lambda seed: gen.from_drawing(drawing, prompt, difficulty, n=LIVE_CANDIDATES, seed=seed),
        detect=lambda image: detect_parts(image, prompt), retries=0, log=log.info, always=True,
        check_drawing=safety.check_picture, rate=True, limit=LIVE_STROKE_LIMITS[difficulty],
    )
    return with_data_urls(drop_covered(pack, canvas_ink), assets)


# The functions that build packs. Tests swap in fakes, so they need no GPU.
BUILD = build_live_pack
REBUILD = rebuild_live_pack


# A line drawing that ships with the site, used as a stand-in photo to warm up the photo path.
WARM_UP_PHOTO = Path(__file__).resolve().parent.parent / "web" / "public" / "subjects" / "mug-medium" / "target.png"


def log_to_file(path: Path = LOG_FILE) -> logging.Handler:
    """Also writes every log line to `path`, with the date and time: our own lines (each request's prompt, result
    and time taken) and uvicorn's access line for each request (who asked, which endpoint, the status code).
    Called after uvicorn has set up its loggers, which don't pass their lines on to the root logger."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    for name in ("", "uvicorn", "uvicorn.access"):  # "" is the root logger, which our own lines reach
        logging.getLogger(name).addHandler(handler)
    return handler


def warm_up() -> None:
    """Loads every model and builds throwaway packs (a typed subject, then a photo), so the first real request is
    fast."""
    start = time.perf_counter()
    BUILD("a cat", None, "medium")
    log.info("warm-up (text) done in %.1f s", time.perf_counter() - start)
    if WARM_UP_PHOTO.exists():
        start = time.perf_counter()
        try:
            BUILD(None, WARM_UP_PHOTO.read_bytes(), "medium")  # no name, so OWLv2 names it, as for a visitor
        except Exception as error:  # noqa: BLE001 - a warm-up drawing that fails the gate is fine
            log.info("warm-up (photo) built no pack (%s); the models are loaded anyway", error)
        log.info("warm-up (photo) done in %.1f s", time.perf_counter() - start)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.environ.get("GHOSTLINES_LOG") == "1":  # set by run_live.ps1
        log_to_file()
    if os.environ.get("GHOSTLINES_WARMUP") == "1":  # set by run_live.ps1
        async with _lock:  # report busy while warming up
            _mark_job(True)
            try:
                await asyncio.to_thread(warm_up)
            finally:
                _mark_job(False)
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
    check_not_stuck()  # the web app asks this on every visit, so a hung job is caught quickly
    return {"ok": True, "gpu": gpu_name(), "busy": _lock.locked()}


@app.post("/generate")
async def generate(request: GenerateRequest):
    kind = "photo" if request.imageBase64 else "prompt"
    try:
        if not request.prompt and not request.imageBase64:
            raise InputError("Type something to draw, or add a photo.")
        prompt = check_prompt(request.prompt) if request.prompt else None
        image = decode_image(request.imageBase64) if request.imageBase64 else None
    except InputError as error:
        log.info("generate %s rejected: %s", kind, error)
        return JSONResponse({"error": str(error)}, status_code=400)
    return await run_job(f"generate {kind}", prompt, request.difficulty,
                         lambda: BUILD(prompt, image, request.difficulty), len(image or b""))


async def run_job(name: str, prompt: str | None, difficulty: str, job, image_bytes: int = 0):
    """Runs one GPU job: 503 if one is already running, 504 after TIMEOUT_S, 400/422/500 on failures."""
    start = time.perf_counter()
    check_not_stuck()
    if _lock.locked():
        log.info("%s %r: busy", name, prompt)
        return JSONResponse({"error": "busy"}, status_code=503)

    from build_pack import NoCleanCandidate

    await _lock.acquire()
    _mark_job(True)
    # The build runs in a worker thread. The lock is released when the build really ends, even if we stop
    # waiting for it, so a timed-out build can't overlap the next one on the GPU.
    task = asyncio.ensure_future(asyncio.to_thread(job))

    def finished(t: asyncio.Future) -> None:
        _mark_job(False)
        _lock.release()
        if not t.cancelled():
            t.exception()  # mark any error as seen; it was already handled or logged

    task.add_done_callback(finished)
    try:
        pack = await asyncio.wait_for(asyncio.shield(task), TIMEOUT_S)
    except asyncio.TimeoutError:
        log.info("%s %r (%s): timed out after %d s", name, prompt, difficulty, TIMEOUT_S)
        return JSONResponse({"error": "timeout"}, status_code=504)
    except safety.UnsafeContent as error:
        log.info("%s %r: refused by the picture check (%s)", name, prompt, error)
        return JSONResponse({"error": REFUSED}, status_code=400)
    except UnknownPhoto as error:
        log.info("%s: couldn't tell what the photo shows (%s)", name, error)
        return JSONResponse({"error": "Couldn't tell what's in that photo. Try one object on a plain background, "
                                      "or type what it is."}, status_code=422)
    except NoCleanCandidate as error:
        log.info("%s %r: no clean drawing (%s)", name, prompt, error)
        hint = "Try another photo, or type what it is." if image_bytes else "Try a simpler subject."
        return JSONResponse({"error": f"Couldn't make a clean drawing of that. {hint}"}, status_code=422)
    except Exception:  # noqa: BLE001 - log it, tell the app it failed
        log.exception("%s %r failed", name, prompt)
        return JSONResponse({"error": "failed"}, status_code=500)
    log.info("%s %r (%s, %d image bytes): ok in %.1f s", name, prompt, difficulty, image_bytes,
             time.perf_counter() - start)
    return pack


@app.post("/regenerate")
async def regenerate(request: RegenerateRequest):
    """Happy accidents: redraws the lesson's target around what the user has drawn so far."""
    try:
        prompt = check_prompt(request.prompt)
        canvas = decode_image(request.canvasBase64)
    except InputError as error:
        log.info("regenerate rejected: %s", error)
        return JSONResponse({"error": str(error)}, status_code=400)
    return await run_job("regenerate", prompt, request.difficulty,
                         lambda: REBUILD(prompt, canvas, request.difficulty), len(canvas))
