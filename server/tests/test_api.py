"""Tests for the live API: input checks, busy and timeout answers. No GPU: the pack builder is faked."""

import asyncio
import base64
import io
import json
import time

import pytest
from PIL import Image

import api
from build_pack import NoCleanCandidate


def run(coro):
    return asyncio.run(coro)


def status(response) -> int:
    return getattr(response, "status_code", 200)


def body(response) -> dict:
    return json.loads(response.body) if hasattr(response, "body") else response


def png_base64(size=(8, 8)) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


FAKE_PACK = {"id": "live-teapot-medium", "target": "data:image/png;base64,AA=="}


@pytest.fixture(autouse=True)
def fake_build(monkeypatch):
    calls = []

    def build(prompt, image, difficulty):
        calls.append((prompt, image is not None, difficulty))
        return FAKE_PACK

    monkeypatch.setattr(api, "BUILD", build)
    return calls


def test_health_says_ok_and_not_busy():
    result = api.health()
    assert result["ok"] is True and result["busy"] is False and isinstance(result["gpu"], str)
    # The web app calls GET /health, so that exact route must exist.
    assert any(route.path == "/health" and "GET" in route.methods for route in api.app.routes)


def test_cors_allows_only_the_site_and_the_dev_server():
    assert api.ALLOWED_ORIGINS == ["http://localhost:5173", "https://aarushgupta850.github.io"]


@pytest.mark.parametrize("prompt", ["a teapot", "  red   fox  ", "Robot 3000", "an F1 car, racing!", "a dog's bone"])
def test_good_prompts_are_cleaned_and_accepted(prompt):
    assert api.check_prompt(prompt) == " ".join(prompt.split())


@pytest.mark.parametrize("prompt", ["", "   ", "x" * 81, "a <b>cat</b>", "cat; rm -rf /", "a naked cat", "GUN",
                                    "n4k3d lady", "p.o.r.n", "pornhub logo", "a NUDE beach"])
def test_bad_prompts_are_rejected(prompt):
    with pytest.raises(api.InputError):
        api.check_prompt(prompt)


def test_images_must_be_small_jpeg_or_png(monkeypatch):
    assert api.decode_image(png_base64())[:4] == b"\x89PNG"
    assert api.decode_image("data:image/png;base64," + png_base64())[:4] == b"\x89PNG"  # data: URLs work too
    with pytest.raises(api.InputError):
        api.decode_image(base64.b64encode(b"GIF89a....").decode())  # not JPEG or PNG
    with pytest.raises(api.InputError):
        api.decode_image("not base64!!")
    monkeypatch.setattr(api, "MAX_IMAGE_BYTES", 10)
    with pytest.raises(api.InputError):
        api.decode_image(png_base64())  # over the (shrunken) limit


def test_generate_returns_the_pack(fake_build):
    response = run(api.generate(api.GenerateRequest(prompt="a teapot", difficulty="simple")))
    assert status(response) == 200 and body(response) == FAKE_PACK
    assert fake_build == [("a teapot", False, "simple")]
    assert not api._lock.locked()  # released after the job


def test_generate_with_a_photo(fake_build):
    response = run(api.generate(api.GenerateRequest(imageBase64=png_base64())))
    assert status(response) == 200
    assert fake_build == [(None, True, "medium")]


def test_bad_input_is_a_400_with_a_reason(fake_build):
    response = run(api.generate(api.GenerateRequest(prompt="draw a gun")))
    assert status(response) == 400 and "something else" in body(response)["error"]
    assert status(run(api.generate(api.GenerateRequest()))) == 400  # neither prompt nor photo
    assert fake_build == []  # the pipeline never ran


def test_busy_while_another_job_runs():
    async def scenario():
        await api._lock.acquire()  # pretend a job is running
        try:
            return await api.generate(api.GenerateRequest(prompt="a teapot"))
        finally:
            api._lock.release()

    response = run(scenario())
    assert status(response) == 503 and body(response) == {"error": "busy"}


def test_timeout_answers_504_and_keeps_the_gpu_locked_until_the_build_ends(monkeypatch):
    monkeypatch.setattr(api, "TIMEOUT_S", 0.1)
    monkeypatch.setattr(api, "BUILD", lambda *args: time.sleep(0.5) or FAKE_PACK)

    async def scenario():
        response = await api.generate(api.GenerateRequest(prompt="a teapot"))
        still_locked = api._lock.locked()  # the slow build is still running in its thread
        await asyncio.sleep(0.7)
        return response, still_locked, api._lock.locked()

    response, locked_during, locked_after = run(scenario())
    assert status(response) == 504 and body(response) == {"error": "timeout"}
    assert locked_during and not locked_after


def test_no_clean_drawing_is_a_422(monkeypatch):
    def build(*args):
        raise NoCleanCandidate("no candidate fit")

    monkeypatch.setattr(api, "BUILD", build)
    response = run(api.generate(api.GenerateRequest(prompt="a teapot")))
    assert status(response) == 422 and "simpler subject" in body(response)["error"]


def test_pack_images_become_data_urls():
    pack = {
        "target": "target.png", "thumb": "thumb.png",
        "pipeline": [{"id": "source", "label": "Prompt", "text": "x"},
                     {"id": "candidates", "label": "3 AI drafts", "images": ["pipeline/candidate-0.webp"]},
                     {"id": "chosen", "label": "Chosen", "image": "pipeline/candidate-0.webp"}],
    }
    assets = {"target.png": b"T", "thumb.png": b"t", "pipeline/candidate-0.webp": b"c"}
    out = api.with_data_urls(pack, assets)
    assert out["target"] == "data:image/png;base64," + base64.b64encode(b"T").decode()
    assert out["pipeline"][1]["images"][0].startswith("data:image/webp;base64,")
    assert out["pipeline"][2]["image"] == out["pipeline"][1]["images"][0]  # chosen still matches its candidate
    assert pack["target"] == "target.png"  # the original is not changed


def test_warm_up_also_warms_the_photo_path_when_both_pipelines_stay(monkeypatch, fake_build):
    monkeypatch.setenv("GHOSTLINES_KEEP_BOTH_PIPELINES", "1")
    api.warm_up()
    assert fake_build == [("a cat", False, "medium"), ("a mug", True, "medium")]
    monkeypatch.delenv("GHOSTLINES_KEEP_BOTH_PIPELINES")
    fake_build.clear()
    api.warm_up()
    assert fake_build == [("a cat", False, "medium")]


def test_a_refused_picture_is_a_400(monkeypatch):
    from pipeline.safety import UnsafeContent

    def build(*args):
        raise UnsafeContent("a gun (0.71)")

    monkeypatch.setattr(api, "BUILD", build)
    response = run(api.generate(api.GenerateRequest(imageBase64=png_base64())))
    assert status(response) == 400 and body(response)["error"] == api.REFUSED


@pytest.mark.parametrize("prompt", ["a cat", "a sunflower", "Dickens' house", "a butterfly", "a scarf", "a cocktail"])
def test_harmless_prompts_pass_the_word_filter(prompt):
    from pipeline.safety import blocked_prompt

    assert not blocked_prompt(prompt)
