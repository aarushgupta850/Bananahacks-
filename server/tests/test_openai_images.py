"""Tests for pipeline/openai_images.py. No network: urllib's urlopen is faked."""

import base64
import io
import json
import urllib.error

import pytest
from PIL import Image

from pipeline import openai_images, safety
from pipeline.prompts import openai_prompt


def png_b64(size=(1024, 1024), color=(255, 255, 255, 0)) -> str:
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def openai_on(monkeypatch):
    monkeypatch.setenv("GHOSTLINES_IMAGE_MODEL", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("GHOSTLINES_OPENAI_MODEL", raising=False)
    monkeypatch.delenv("GHOSTLINES_OPENAI_QUALITY", raising=False)


def test_off_unless_switched_on(monkeypatch):
    assert not openai_images.enabled()  # conftest sets "sdxl"
    monkeypatch.setenv("GHOSTLINES_IMAGE_MODEL", "OpenAI")
    assert openai_images.enabled()


def test_draws_n_drafts_as_768_drawings_on_white(monkeypatch, openai_on):
    sent = []

    def urlopen(request, timeout):
        sent.append((request.full_url, request.headers, json.loads(request.data)))
        return FakeResponse({"data": [{"b64_json": png_b64()}]})  # a transparent picture

    monkeypatch.setattr(openai_images.urllib.request, "urlopen", urlopen)
    drawings = openai_images.from_prompt("a monkey", "simple", n=2)
    assert len(drawings) == 2 and len(sent) == 2
    assert all(d.size == (768, 768) and d.mode == "RGB" for d in drawings)
    assert drawings[0].getpixel((10, 10)) == (255, 255, 255)  # transparent became white paper
    url, headers, body = sent[0]
    assert url == openai_images.API_URL and headers["Authorization"] == "Bearer sk-test"
    assert body == {"model": "gpt-image-1", "prompt": openai_prompt("a monkey", "simple"), "n": 1,
                    "size": "1024x1024", "quality": "medium"}


def test_dall_e_asks_for_the_picture_itself(monkeypatch, openai_on):
    monkeypatch.setenv("GHOSTLINES_OPENAI_MODEL", "dall-e-3")
    body = openai_images.request_body("x")
    assert body["response_format"] == "b64_json" and "quality" not in body


def test_a_refusal_by_openai_is_a_refusal_for_the_user(monkeypatch, openai_on):
    def urlopen(request, timeout):
        payload = io.BytesIO(json.dumps({"error": {"code": "moderation_blocked", "message": "no"}}).encode())
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, payload)

    monkeypatch.setattr(openai_images.urllib.request, "urlopen", urlopen)
    with pytest.raises(safety.UnsafeContent):
        openai_images.from_prompt("something", n=1)


def test_other_failures_and_a_missing_key_are_clear_errors(monkeypatch, openai_on):
    def urlopen(request, timeout):
        raise urllib.error.URLError("no internet")

    monkeypatch.setattr(openai_images.urllib.request, "urlopen", urlopen)
    with pytest.raises(openai_images.OpenAIImageError, match="couldn't reach OpenAI"):
        openai_images.from_prompt("a cat", n=1)
    monkeypatch.setattr(openai_images, "_setting", lambda name: "" if name == "OPENAI_API_KEY" else "openai")
    with pytest.raises(openai_images.OpenAIImageError, match="OPENAI_API_KEY"):
        openai_images.from_prompt("a cat", n=1)


def test_generate_hands_typed_subjects_to_openai_when_on(monkeypatch, openai_on):
    from pipeline import generate

    monkeypatch.setattr(openai_images, "from_prompt", lambda subject, difficulty, n: [subject, difficulty, n])
    monkeypatch.setattr(generate, "_pipeline", lambda kind: pytest.fail("SDXL must not load"))
    assert generate.from_prompt("a fox", "detailed", n=2) == ["a fox", "detailed", 2]


def test_the_openai_prompt_names_the_subject_and_the_detail_level():
    prompt = openai_prompt("  a   basketball ", "simple")
    assert "a basketball," in prompt and "as few lines as possible" in prompt and "no background" in prompt
    with pytest.raises(ValueError):
        openai_prompt("", "simple")
    with pytest.raises(ValueError):
        openai_prompt("a cat", "hard")


def test_live_lessons_ask_openai_for_two_drafts_and_wait_longer(openai_on):
    import api

    assert api.live_candidates() == 2
    assert api.timeout_s() == api.OPENAI_TIMEOUT_S
