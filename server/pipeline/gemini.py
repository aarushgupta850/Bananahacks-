"""Google Gemini as the live server's eyes (optional, on when GEMINI_API_KEY is set): it names what an uploaded photo
shows, and it reviews the AI drafts of each lesson like a teacher would, before one is chosen.

- name_photo: "a monkey", "a person", "a coffee mug"... any subject. OWLv2 (generate.name_subject) can only pick
  from a fixed list of about 90 subjects, so a monkey came back as "a bear" and a person as "a t-shirt".
- review: for each draft, does it show the subject (whole, drawn correctly) and is it clean (no arcs, rings, ground
  lines, scenery, frames or scribbles that aren't part of the subject)? build_pack.make_pack counts the answers
  when it chooses a draft, and asks the image model again when none is good and there is time left.

The free tier is enough (Gemini's image models are not free, but reading pictures is). Its models are often busy
("high demand", HTTP 503) or retired for new keys, so several are tried in turn, all within a time budget. When
none answers in time, the lesson is built without Gemini: photos are named by OWLv2 and drafts are judged by the
local checks alone. The key goes in .env (never committed). No new Python package: urllib from the standard library.

Tested on Oct 13 with gemini-3.1-flash-lite (gemini-3.5-flash was busy): it named an astronaut, a coffee cup, a cat,
a rocket and drawings of a monkey and a car correctly, and on the saved drafts it flagged the car's big arc and
ground line, the fox's and cat's background rings, and passed the clean drafts. About 5-10 s per call.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from PIL import Image

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Tried in this order. GHOSTLINES_GEMINI_MODELS (comma-separated) can replace the list.
DEFAULT_MODELS = ("gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview")
NAME_BUDGET_S = 20    # name_photo gives up after this long, in total over all models
REVIEW_BUDGET_S = 20  # review likewise
ATTEMPT_S = 15        # one model gets at most this long
IMAGE_SIDE = 512      # pictures are sent as JPEGs this big (plenty to judge a line drawing, and fast to upload)

log = logging.getLogger("ghostlines.live")


def _setting(name: str) -> str:
    """A setting from the shell, else from the repo's .env file (the shell wins, as for HF_HOME)."""
    if os.environ.get(name):
        return os.environ[name].strip()
    from scripts.download_models import ENV_FILE, read_env_file

    return read_env_file(ENV_FILE).get(name, "").strip()


def enabled() -> bool:
    """True when GEMINI_API_KEY is set, unless GHOSTLINES_GEMINI=0 turns Gemini off."""
    return bool(_setting("GEMINI_API_KEY")) and _setting("GHOSTLINES_GEMINI") != "0"


def models() -> list[str]:
    names = _setting("GHOSTLINES_GEMINI_MODELS")
    return [m.strip() for m in names.split(",") if m.strip()] if names else list(DEFAULT_MODELS)


def _jpeg(image: Image.Image) -> dict:
    picture = image.convert("RGB")
    picture.thumbnail((IMAGE_SIDE, IMAGE_SIDE))
    buffer = io.BytesIO()
    picture.save(buffer, "JPEG", quality=85)
    return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buffer.getvalue()).decode()}}


def ask(prompt: str, images: list[Image.Image], schema: dict, budget_s: float, valid=lambda answer: True):
    """Gemini's answer as parsed JSON (shaped by `schema`), or None when no model gave a `valid` answer within
    budget_s."""
    key = _setting("GEMINI_API_KEY")
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}, *(_jpeg(image) for image in images)]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": schema},
    }).encode()
    give_up = time.monotonic() + budget_s
    for model in models():
        left = give_up - time.monotonic()
        if left < 1:
            break
        request = urllib.request.Request(API_URL.format(model=model), data=body, method="POST",
                                         headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(request, timeout=min(ATTEMPT_S, left)) as response:
                answer = json.loads(response.read())
            parsed = json.loads(answer["candidates"][0]["content"]["parts"][0]["text"])
            if valid(parsed):
                return parsed
            log.info("  gemini %s: answer of the wrong shape, trying the next model", model)
        except urllib.error.HTTPError as error:  # busy (503), over the free quota (429), retired (404)...
            log.info("  gemini %s: HTTP %d, trying the next model", model, error.code)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            log.info("  gemini %s: no answer (%s), trying the next model", model, error)
        except (KeyError, IndexError, ValueError) as error:  # blocked or malformed answer
            log.info("  gemini %s: unusable answer (%s), trying the next model", model, error)
    return None


# ---------------------------------------------------------------- naming a photo

NAME_PROMPT = (
    "A user uploaded this picture to get a drawing lesson of what it shows. Name its main subject as something a "
    "beginner can draw: a short noun phrase of 1-4 words with 'a' or 'an', like 'a monkey', 'a person', 'a coffee "
    "mug', 'a sneaker'. Name the whole subject, not a part of it or a piece of clothing it wears (a person in a "
    "t-shirt is 'a person'). confident: false if there is no clear single subject. safe: false if it shows nudity, "
    "sexual content, gore or weapons."
)
NAME_SCHEMA = {
    "type": "OBJECT",
    "properties": {"subject": {"type": "STRING"}, "confident": {"type": "BOOLEAN"}, "safe": {"type": "BOOLEAN"}},
    "required": ["subject", "confident", "safe"],
}


@dataclass
class PhotoName:
    subject: str | None  # e.g. "a monkey"; None when Gemini saw no clear subject
    safe: bool


def name_photo(photo: Image.Image) -> PhotoName | None:
    """What the photo shows, or None when Gemini didn't answer (then OWLv2 names it)."""
    answer = ask(NAME_PROMPT, [photo], NAME_SCHEMA, NAME_BUDGET_S, valid=lambda a: isinstance(a, dict))
    if answer is None:
        return None
    subject = " ".join(str(answer.get("subject", "")).lower().split()).strip(" .")
    confident = bool(answer.get("confident")) and 0 < len(subject) <= 40
    return PhotoName(subject if confident else None, safe=answer.get("safe") is not False)


# ---------------------------------------------------------------- reviewing drafts

REVIEW_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "shows_subject": {"type": "BOOLEAN"},
            "clean": {"type": "BOOLEAN"},
            "problems": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["shows_subject", "clean", "problems"],
    },
}


def review_prompt(subject: str, n: int) -> str:
    return (
        f"These {n} pictures are AI drafts for a beginner's drawing lesson of {subject}. A good draft is one black "
        f"line drawing of the whole subject and nothing else. For each picture, in order, say: shows_subject: is it "
        "recognizably the subject, whole and drawn correctly (the right number of legs, eyes, wheels...)? clean: "
        "does it have NO extra marks that are not part of the subject (arcs or circles behind it, ground or shadow "
        "lines, scenery, plants, frames, text, scribbles)? Gray paper, gray shading and texture are fine. problems: "
        "a few words for each problem, empty if none."
    )


@dataclass
class Review:
    shows_subject: bool
    clean: bool
    problems: list[str] = field(default_factory=list)

    @property
    def good(self) -> bool:
        return self.shows_subject and self.clean


def review(images: list[Image.Image], subject: str) -> list[Review] | None:
    """One Review per draft, in order, or None when Gemini didn't answer (or answered for the wrong number)."""
    if not images:
        return []
    answer = ask(review_prompt(subject, len(images)), images, REVIEW_SCHEMA, REVIEW_BUDGET_S,
                 valid=lambda a: isinstance(a, list) and len(a) == len(images) and all(isinstance(x, dict) for x in a))
    if answer is None:
        return None
    return [Review(bool(a.get("shows_subject", True)), bool(a.get("clean", True)),
                   [str(p) for p in a.get("problems", [])][:5]) for a in answer]
