"""Tests for the pipeline cache in pipeline/generate.py. No GPU: model loading is faked."""

import numpy as np
from PIL import Image

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
    assert set(generate._cache) - {"active"} == {"photo"}  # the text pipeline made room
    generate._pipeline("text")
    assert loads == [False, True, False]  # so switching back reloads it


def test_the_live_server_keeps_both_pipelines_sharing_weights(monkeypatch):
    monkeypatch.setenv("GHOSTLINES_KEEP_BOTH_PIPELINES", "1")
    loads = fake_models(monkeypatch)
    built, readied = [], []
    monkeypatch.setattr(models, "photo_pipeline_from", lambda text: built.append(text) or "photo-pipe")
    monkeypatch.setattr(models, "use_pipeline", lambda pipe: readied.append(pipe))
    for kind in ["text", "photo", "photo", "text"]:
        generate._pipeline(kind)
    assert loads == [False]  # SDXL loaded once
    assert built == [generate._cache["text"]]  # the photo pipeline is built on the text pipeline's weights
    assert readied == ["photo-pipe", generate._cache["text"]]  # offloading re-attached only on a switch


def test_img2img_is_built_on_the_text_pipeline_and_switches_hooks(monkeypatch):
    monkeypatch.delenv("GHOSTLINES_KEEP_BOTH_PIPELINES", raising=False)
    loads = fake_models(monkeypatch)
    readied = []
    monkeypatch.setattr(models, "img2img_pipeline_from", lambda text: ("img2img-of", text))
    monkeypatch.setattr(models, "use_pipeline", lambda pipe: readied.append(pipe))
    img2img = generate._pipeline("img2img")
    assert loads == [False] and img2img == ("img2img-of", generate._cache["text"])
    generate._pipeline("text")
    generate._pipeline("img2img")
    assert loads == [False]  # never reloaded
    assert readied == [img2img, generate._cache["text"], img2img]  # hooks follow whichever pipeline runs


def test_clean_photo_lines_keeps_outlines_and_drops_texture_and_specks():
    from pipeline.generate import clean_photo_lines

    soft = np.zeros((1024, 1024), np.uint8)
    yy, xx = np.mgrid[:1024, :1024]
    ring = np.abs(np.hypot(xx - 512, yy - 512) - 300) < 3
    soft[ring] = 220                                    # a strong outline
    rng = np.random.default_rng(0)
    soft[rng.random((1024, 1024)) < 0.2] = 60           # faint texture everywhere (grass, fur)
    soft[100:104, 100:104] = 230                        # a bright speck
    out = np.asarray(clean_photo_lines(Image.fromarray(soft)))
    assert out[ring].mean() < 50                        # the outline is kept, black
    assert (out[~ring] < 128).mean() < 0.02             # texture is gone (only the thickened outline remains)
    assert out[100:104, 100:104].min() == 255           # the speck is gone
