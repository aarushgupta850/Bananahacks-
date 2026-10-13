"""Tests for pipeline/gemini.py. No network: urllib's urlopen is faked."""

import io
import json
import urllib.error

import pytest
from PIL import Image

from pipeline import gemini


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(self.payload)}]}}]}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def gemini_on(monkeypatch):
    monkeypatch.setenv("GHOSTLINES_GEMINI", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GHOSTLINES_GEMINI_MODELS", "busy-model,good-model")


def fake_api(monkeypatch, answers: dict):
    """answers: model name -> payload, or an HTTP status code to fail with."""
    asked = []

    def urlopen(request, timeout):
        model = request.full_url.split("/models/")[1].split(":")[0]
        asked.append((model, request.headers, json.loads(request.data)))
        answer = answers[model]
        if isinstance(answer, int):
            raise urllib.error.HTTPError(request.full_url, answer, "error", {}, io.BytesIO(b"{}"))
        return FakeResponse(answer)

    monkeypatch.setattr(gemini.urllib.request, "urlopen", urlopen)
    return asked


def picture():
    return Image.new("RGB", (900, 600), (200, 150, 100))


def test_off_without_a_key_or_when_switched_off(monkeypatch):
    assert not gemini.enabled()  # conftest sets GHOSTLINES_GEMINI=0
    monkeypatch.setenv("GHOSTLINES_GEMINI", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert gemini.enabled()


def test_names_a_photo_trying_the_next_model_when_one_is_busy(monkeypatch, gemini_on):
    asked = fake_api(monkeypatch, {"busy-model": 503,
                                   "good-model": {"subject": "A  Monkey.", "confident": True, "safe": True}})
    named = gemini.name_photo(picture())
    assert named == gemini.PhotoName("a monkey", safe=True)
    assert [m for m, *_ in asked] == ["busy-model", "good-model"]
    model, headers, body = asked[1]
    assert headers["X-goog-api-key"] == "test-key"  # the key goes in a header, not the URL
    assert body["contents"][0]["parts"][1]["inline_data"]["mime_type"] == "image/jpeg"


def test_an_unclear_or_unsafe_photo_and_no_answer(monkeypatch, gemini_on):
    fake_api(monkeypatch, {"busy-model": 503, "good-model": {"subject": "", "confident": False, "safe": False}})
    assert gemini.name_photo(picture()) == gemini.PhotoName(None, safe=False)
    fake_api(monkeypatch, {"busy-model": 503, "good-model": 429})
    assert gemini.name_photo(picture()) is None  # then OWLv2 names it


def test_reviews_each_draft_in_order(monkeypatch, gemini_on):
    fake_api(monkeypatch, {"busy-model": {"x": 1}, "good-model": [
        {"shows_subject": True, "clean": False, "problems": ["arc over the car"]},
        {"shows_subject": True, "clean": True, "problems": []}]})
    reviews = gemini.review([picture(), picture()], "a car")
    assert [r.good for r in reviews] == [False, True] and reviews[0].problems == ["arc over the car"]


def test_a_review_for_the_wrong_number_of_drafts_is_no_review(monkeypatch, gemini_on):
    fake_api(monkeypatch, {"busy-model": 503, "good-model": [{"shows_subject": True, "clean": True, "problems": []}]})
    assert gemini.review([picture(), picture()], "a car") is None


def test_the_live_server_names_photos_with_gemini_and_checks_the_name(monkeypatch, gemini_on):
    import api
    from pipeline import safety

    monkeypatch.setattr(gemini, "name_photo", lambda photo: gemini.PhotoName("a monkey", True))
    assert api.name_photo(picture()) == "a monkey"
    monkeypatch.setattr(gemini, "name_photo", lambda photo: gemini.PhotoName("a person", False))
    with pytest.raises(safety.UnsafeContent):
        api.name_photo(picture())
    monkeypatch.setattr(gemini, "name_photo", lambda photo: gemini.PhotoName(None, True))
    with pytest.raises(api.UnknownPhoto):
        api.name_photo(picture())
    monkeypatch.setattr(gemini, "name_photo", lambda photo: None)
    assert api.name_photo(picture()) is None  # OWLv2's turn
    monkeypatch.setenv("GHOSTLINES_GEMINI", "0")
    assert api.name_photo(picture()) is None
