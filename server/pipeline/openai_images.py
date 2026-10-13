"""Draws the line-art drafts with OpenAI's image model instead of SDXL-Lightning (optional, off by default).

Switch it on with GHOSTLINES_IMAGE_MODEL=openai and an OPENAI_API_KEY (in the shell or in .env, which is never
committed). Then typed subjects and photos (which OWLv2 names first, e.g. "a mug") are drawn by OpenAI; everything
after the drafts (choosing the cleanest, tracing, OWLv2 parts, the safety check, the lesson order) is unchanged.
Happy accidents (?happy=1) still uses SDXL img2img.

Why: SDXL-Lightning has to draw in 4 or 8 steps to fit the live time limit on an 8 GB card, and it draws round
and mirror-image subjects (a monkey's face, a basketball's seams) lopsided, with stray background things.
OpenAI's model follows the prompt much more closely, but it costs money per image and needs the internet.

No new Python package: the API is called with urllib from the standard library.
"""

from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from pipeline.prompts import openai_prompt

API_URL = "https://api.openai.com/v1/images/generations"
DEFAULT_MODEL = "gpt-image-1"  # GHOSTLINES_OPENAI_MODEL can name another, e.g. "dall-e-3"
DEFAULT_QUALITY = "medium"     # GHOSTLINES_OPENAI_QUALITY: "low" is faster and cheaper, "high" slower
SIZE = "1024x1024"             # square, like the 768 x 768 target space
TARGET_SIZE = 768
REQUEST_TIMEOUT_S = 60         # one image; the drafts are requested at the same time, not one after another
# OpenAI's error codes for a prompt or picture its own safety system refused. Shown to the user like our own refusal.
REFUSED_CODES = {"moderation_blocked", "content_policy_violation"}


class OpenAIImageError(RuntimeError):
    """The OpenAI request failed (no key, no internet, a bad answer). The live server answers 500 "failed"."""


def enabled() -> bool:
    """True when GHOSTLINES_IMAGE_MODEL=openai (in the shell or in .env)."""
    return _setting("GHOSTLINES_IMAGE_MODEL").lower() == "openai"


def model() -> str:
    return _setting("GHOSTLINES_OPENAI_MODEL") or DEFAULT_MODEL


def _setting(name: str) -> str:
    """A setting from the shell, else from the repo's .env file (the shell wins, as for HF_HOME)."""
    if os.environ.get(name):
        return os.environ[name].strip()
    from scripts.download_models import ENV_FILE, read_env_file

    return read_env_file(ENV_FILE).get(name, "").strip()


def request_body(prompt: str) -> dict:
    """The JSON for one image. The DALL-E models need response_format to send the picture itself (not a link);
    the gpt-image models always send it and don't accept that field, but do accept a quality."""
    body = {"model": model(), "prompt": prompt, "n": 1, "size": SIZE}
    if model().startswith("dall-e"):
        body["response_format"] = "b64_json"
    else:
        body["quality"] = _setting("GHOSTLINES_OPENAI_QUALITY") or DEFAULT_QUALITY
    return body


def _post(body: dict, key: str) -> dict:
    """Sends one request and returns the decoded answer. A refusal by OpenAI's safety system becomes
    safety.UnsafeContent (so the user sees the same "Let's draw something else." as for our own checks)."""
    from pipeline import safety

    request = urllib.request.Request(
        API_URL, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read()).get("error") or {}
        except (ValueError, AttributeError):
            details = {}
        if details.get("code") in REFUSED_CODES:
            raise safety.UnsafeContent(f"OpenAI refused the prompt ({details.get('code')})") from error
        raise OpenAIImageError(f"OpenAI answered {error.code}: {details.get('message', 'no message')}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise OpenAIImageError(f"couldn't reach OpenAI: {error}") from error


def to_drawing(data: str) -> Image.Image:
    """A base64 picture from the API as a 768 x 768 RGB drawing. A transparent background becomes white paper."""
    picture = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")
    paper = Image.new("RGBA", picture.size, (255, 255, 255, 255))
    paper.alpha_composite(picture)
    return paper.convert("RGB").resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def from_prompt(subject: str, difficulty: str = "medium", n: int = 2) -> list[Image.Image]:
    """n drafts of `subject`, 768 x 768, like generate.from_prompt. The n requests run at the same time, so n drafts
    take about as long as one. There are no seeds: every call draws new pictures."""
    key = _setting("OPENAI_API_KEY")
    if not key:
        raise OpenAIImageError("GHOSTLINES_IMAGE_MODEL=openai needs OPENAI_API_KEY in the shell or in .env")
    body = request_body(openai_prompt(subject, difficulty))
    with ThreadPoolExecutor(max_workers=n) as pool:
        answers = list(pool.map(lambda _: _post(body, key), range(n)))
    drawings = []
    for answer in answers:
        data = (answer.get("data") or [{}])[0].get("b64_json")
        if not data:
            raise OpenAIImageError("OpenAI's answer held no picture")
        drawings.append(to_drawing(data))
    return drawings


def drafts_text(n: int) -> str:
    """The "AI drafts" line of the "How this lesson was made" panel."""
    return f"OpenAI's {model()} drew {n} line-art drafts."
