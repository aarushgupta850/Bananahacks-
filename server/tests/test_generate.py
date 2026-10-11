"""Tests for the pipeline cache in pipeline/generate.py. No GPU: model loading is faked."""

from pipeline import generate, models


def fake_models(monkeypatch):
    loads = []
    monkeypatch.setattr(models, "load_lightning", lambda with_controlnet=False: loads.append(with_controlnet) or object())
    monkeypatch.setattr(models, "free_gpu", lambda: None)
    monkeypatch.setattr(generate, "_cache", {})
    return loads


def test_one_pipeline_at_a_time_by_default(monkeypatch):
    monkeypatch.delenv("GHOSTLINES_KEEP_BOTH_PIPELINES", raising=False)
    loads = fake_models(monkeypatch)
    generate._pipeline("text")
    generate._pipeline("photo")
    assert set(generate._cache) == {"photo"}  # the text pipeline made room
    generate._pipeline("text")
    assert loads == [False, True, False]  # so switching back reloads it


def test_the_live_server_keeps_both_pipelines(monkeypatch):
    monkeypatch.setenv("GHOSTLINES_KEEP_BOTH_PIPELINES", "1")
    loads = fake_models(monkeypatch)
    for kind in ["text", "photo", "text", "photo"]:
        generate._pipeline(kind)
    assert set(generate._cache) == {"text", "photo"}
    assert loads == [False, True]  # each loaded once, never reloaded
