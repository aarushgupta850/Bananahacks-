"""Tests for the live API: input checks, busy and timeout answers. No GPU: the pack builder is faked."""

import asyncio
import base64
import io
import json
import time
from pathlib import Path

import pytest
from PIL import Image

import api

DEMO_PACK_TEXT = (Path(__file__).resolve().parents[2] / 'web/public/subjects/demo-fox-medium/pack.json').read_text()
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
        api.decode_image(base64.b64encode(b"GIF89a....").decode())  # not JPEG, PNG or WebP
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
    # A photo with no clean drawing gets a hint about photos instead.
    response = run(api.generate(api.GenerateRequest(imageBase64=png_base64())))
    assert status(response) == 422 and "type what it is" in body(response)["error"]


def test_a_photo_nothing_can_be_named_in_is_a_422_with_a_hint(monkeypatch):
    def build(*args):
        raise api.UnknownPhoto("nothing matched")

    monkeypatch.setattr(api, "BUILD", build)
    response = run(api.generate(api.GenerateRequest(imageBase64=png_base64())))
    assert status(response) == 422 and "Couldn't tell what's in that photo" in body(response)["error"]
    assert not api._lock.locked()


def live_pack_fakes(monkeypatch, name):
    """Fakes for build_live_pack's GPU steps: OWLv2 names the photo `name`, and the AI draws a simple cat."""
    from pipeline import generate, parts
    from test_build_pack import cat_drawing

    calls = {"named": 0, "drawn": [], "checked": 0}

    def name_subject(photo):
        calls["named"] += 1
        return name

    def from_prompt(words, difficulty, n, seed):
        calls["drawn"].append(words)
        return [cat_drawing()] * n

    def check_picture(image):
        calls["checked"] += 1

    monkeypatch.setattr(generate, "name_subject", name_subject)
    monkeypatch.setattr(generate, "from_prompt", from_prompt)
    monkeypatch.setattr(parts, "detect_parts", lambda image, subject: [])
    monkeypatch.setattr(api.safety, "check_picture", check_picture)
    return calls


def jpeg_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), "white").save(buffer, "JPEG")
    return buffer.getvalue()


def test_a_photo_is_named_by_owlv2_and_drawn_from_that_name(monkeypatch):
    calls = live_pack_fakes(monkeypatch, "a mug")
    pack = api.build_live_pack(None, jpeg_bytes(), "medium")
    # Drawn from the name, like a typed subject. (The fake cat is too simple for "medium", so the AI is asked once
    # more for detail, with the same name.)
    assert calls["named"] == 1 and calls["drawn"][0] == "a mug" and all(w.startswith("a mug") for w in calls["drawn"])
    assert calls["checked"] == 2  # the photo and the chosen drawing were both checked
    assert pack["title"] == "A mug"
    assert pack["source"] == {"kind": "photo", "prompt": "a mug"}
    source = pack["pipeline"][0]
    assert source["label"] == "Photo" and source["image"].startswith("data:image/webp")  # the panel shows the photo
    assert "recognized your photo as a mug" in source["text"]  # and says honestly what happened to it


def test_a_photo_with_a_typed_name_uses_the_name(monkeypatch):
    calls = live_pack_fakes(monkeypatch, "a cat")
    pack = api.build_live_pack("a teapot", jpeg_bytes(), "medium")
    assert calls["named"] == 0 and calls["drawn"][0] == "a teapot" and all(w.startswith("a teapot") for w in calls["drawn"])
    assert pack["title"] == "A teapot" and "You named your photo" in pack["pipeline"][0]["text"]


def test_a_photo_nothing_is_recognized_in_is_refused_before_any_drawing(monkeypatch):
    calls = live_pack_fakes(monkeypatch, None)
    with pytest.raises(api.UnknownPhoto):
        api.build_live_pack(None, jpeg_bytes(), "medium")
    assert calls["drawn"] == []


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


def test_warm_up_builds_a_typed_lesson_then_a_photo_lesson(fake_build):
    api.warm_up()
    assert fake_build == [("a cat", False, "medium"), (None, True, "medium")]  # the photo unnamed, as from a visitor


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


# ---------------------------------------------------------------- Happy accidents (/regenerate)


def test_regenerate_returns_the_new_pack(monkeypatch):
    calls = []
    monkeypatch.setattr(api, "REBUILD", lambda prompt, canvas, difficulty: calls.append((prompt, difficulty)) or FAKE_PACK)
    response = run(api.regenerate(api.RegenerateRequest(prompt="a fox", canvasBase64=png_base64())))
    assert status(response) == 200 and body(response) == FAKE_PACK
    assert calls == [("a fox", "medium")]
    assert not api._lock.locked()


def test_regenerate_checks_its_input_like_generate():
    assert status(run(api.regenerate(api.RegenerateRequest(prompt="a naked fox", canvasBase64=png_base64())))) == 400
    assert status(run(api.regenerate(api.RegenerateRequest(prompt="a fox", canvasBase64="not base64!!")))) == 400


def test_drop_covered_removes_drawn_strokes_and_construction_and_empty_steps():
    import numpy as np

    def stroke(sid, points, tier="outline"):
        return {"id": sid, "points": points, "tier": tier, "partId": None, "keyPoints": [points[0]]}

    pack = json.loads(DEMO_PACK_TEXT)
    pack["strokes"] = [
        stroke("c-head", [[100, 100], [200, 100]], "construction"),
        stroke("drawn", [[100, 300], [400, 300]]),      # the user drew right on top of this one
        stroke("new", [[100, 600], [400, 600]]),
    ]
    pack["parts"] = []
    pack["steps"] = [
        {"id": "s1", "label": "Block in", "tier": "construction", "strokeIds": ["c-head"], "tip": ""},
        {"id": "s2", "label": "Outline", "tier": "outline", "strokeIds": ["drawn", "new"], "tip": ""},
    ]
    ink = np.zeros((768, 768), bool)
    ink[296:304, 95:405] = True  # a user line along y = 300
    out = api.drop_covered(pack, ink)
    assert [s["id"] for s in out["strokes"]] == ["new"]
    assert [(s["id"], s["strokeIds"]) for s in out["steps"]] == [("s2", ["new"])]


def test_webp_photos_are_accepted_and_broken_files_refused():
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buffer, "WEBP")
    assert api.decode_image(base64.b64encode(buffer.getvalue()).decode())[:4] == b"RIFF"
    truncated = base64.b64decode(png_base64())[:20]  # a PNG header with nothing after it
    with pytest.raises(api.InputError, match="couldn't be read"):
        api.decode_image(base64.b64encode(truncated).decode())


def test_the_log_file_gets_our_lines_and_uvicorns_access_lines_with_the_time(tmp_path):
    import logging

    path = tmp_path / "out" / "live.log"
    handler = api.log_to_file(path)
    try:
        api.log.info("generate prompt 'a teapot' (medium): ok in 18.2 s")
        access = logging.getLogger("uvicorn.access")
        access.setLevel(logging.INFO)
        access.propagate = False  # as uvicorn sets it up: its lines never reach the root logger
        access.info('%s - "%s %s HTTP/%s" %d', "203.0.113.7:0", "POST", "/generate", "1.1", 200)
    finally:
        for name in ("", "uvicorn", "uvicorn.access"):
            logging.getLogger(name).removeHandler(handler)
        handler.close()
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert lines[0].endswith("ok in 18.2 s") and lines[1].endswith('"POST /generate HTTP/1.1" 200')
    assert all(line[:4].isdigit() and line[4] == "-" for line in lines)  # each starts with the date


def test_the_picture_check_compares_on_the_same_box():
    import numpy as np

    from pipeline import safety

    n_unsafe, n_safe = len(safety.UNSAFE_QUERIES), len(safety.SAFE_QUERIES)

    def scores(*boxes):  # each box: {query: score}; other queries score 0.01
        out = np.full((len(boxes), n_unsafe + n_safe), 0.01)
        names = [*safety.UNSAFE_QUERIES, *safety.SAFE_QUERIES]
        for b, values in enumerate(boxes):
            for query, value in values.items():
                out[b, names.index(query)] = value
        return out

    # The close-up portrait refused before: 0.319 "a naked person", but 0.332 "a person wearing clothes", same box.
    assert safety.unsafe_match(scores({"a naked person": 0.319, "a clothed person": 0.281,
                                       "a person wearing clothes": 0.332})) is None
    # Nudity on one box isn't excused by a clothed person on another box (two people in the picture).
    found = safety.unsafe_match(scores({"a naked person": 0.6, "a clothed person": 0.1},
                                       {"a clothed person": 0.8}))
    assert found and found.startswith("a naked person")
    # Weapons need the surer match.
    assert safety.unsafe_match(scores({"a knife": 0.35})) is None
    assert safety.unsafe_match(scores({"a knife": 0.5})).startswith("a knife")


def test_a_hung_job_restarts_the_server(monkeypatch):
    exits = []
    monkeypatch.setattr(api, "_exit_for_restart", lambda: exits.append(True))
    monkeypatch.setattr(api, "STUCK_S", 0.2)

    async def scenario():
        await api._lock.acquire()  # a job that never finishes
        api._mark_job(True)
        try:
            api.health()  # not stuck yet: nothing happens
            first = list(exits)
            await asyncio.sleep(0.3)
            api.health()  # now held too long: the server exits so run_live.ps1 restarts it
            return first
        finally:
            api._mark_job(False)
            api._lock.release()

    assert run(scenario()) == [] and exits == [True]


def test_a_normal_job_never_triggers_the_restart(monkeypatch, fake_build):
    exits = []
    monkeypatch.setattr(api, "_exit_for_restart", lambda: exits.append(True))
    run(api.generate(api.GenerateRequest(prompt="a teapot")))
    api.health()
    assert exits == [] and api._job_started is None and not api._lock.locked()


def test_a_medium_lesson_asks_for_more_detail_when_every_draft_is_too_simple(monkeypatch):
    calls = live_pack_fakes(monkeypatch, "a cat")
    api.build_live_pack("a cat", None, "medium")
    assert calls["drawn"] == ["a cat", f"a cat, {api.DETAIL_HINT}"]  # the fake cat has under 26 strokes
    calls["drawn"].clear()
    api.build_live_pack("a cat", None, "simple")
    assert calls["drawn"] == ["a cat"]  # simple needs no minimum
