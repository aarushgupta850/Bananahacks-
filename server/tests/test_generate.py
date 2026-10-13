"""Tests for pipeline/generate.py: the pipeline cache and naming what a photo shows. No GPU: models are faked."""

import numpy as np

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


def test_a_photo_is_named_after_its_big_subject_not_a_small_detail():
    from pipeline.generate import best_subject

    # Two boxes on a 1000 x 800 photo: a big one around the dog, a tiny one around a bottle on a shelf.
    boxes = np.array([[0.5, 0.45, 0.6, 0.5], [0.9, 0.1, 0.05, 0.08]])
    scores = np.array([[0.35, 0.02],    # the big box: dog 0.35, bottle 0.02
                       [0.01, 0.60]])   # the tiny box: the bottle scores higher, but it isn't the subject
    assert best_subject(scores, boxes, (1000, 800)) == (0, 0.35)


def test_a_photo_of_nothing_recognizable_has_no_name_and_small_photos_still_count():
    from pipeline.generate import NAME_MIN_SCORE, best_subject

    boxes = np.array([[0.5, 0.5, 0.6, 0.6]])
    assert best_subject(np.array([[NAME_MIN_SCORE / 2, 0.03]]), boxes, (800, 800)) is None
    # If every box is small (a subject far away), the small boxes are used rather than nothing.
    small = np.array([[0.5, 0.5, 0.08, 0.08]])
    assert best_subject(np.array([[0.05, 0.4]]), small, (800, 800)) == (1, 0.4)


def test_every_photo_subject_is_an_allowed_prompt_and_listed_once():
    from pipeline import safety
    from pipeline.generate import PHOTO_SUBJECTS

    assert len(PHOTO_SUBJECTS) == len(set(PHOTO_SUBJECTS))
    assert not [s for s in PHOTO_SUBJECTS if safety.blocked_prompt(s)]


def fake_torch(monkeypatch):
    """_generate only needs torch.Generator(...).manual_seed(...); the tests don't need the real (GPU) torch."""
    import sys
    import types

    class Generator:
        def __init__(self, device):
            pass

        def manual_seed(self, seed):
            return self

    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(Generator=Generator))


class FakeFlux:
    """Stands in for diffusers' FluxPipeline: records how it was called."""

    def __init__(self):
        self.calls = []

    def __call__(self, prompt, **kwargs):
        from PIL import Image

        self.calls.append((prompt, kwargs))
        return type("Out", (), {"images": [Image.new("RGB", (kwargs["width"], kwargs["height"]), "white")]})()


FakeFlux.__name__ = "FluxPipeline"  # models.is_flux looks at the class name


def test_flux_draws_typed_subjects_at_768_in_4_steps_with_its_own_prompt(monkeypatch):
    fake_models(monkeypatch)
    fake_torch(monkeypatch)
    flux = FakeFlux()
    monkeypatch.setattr(models, "load_flux", lambda: flux)
    monkeypatch.setenv("GHOSTLINES_IMAGE_MODEL", "flux")
    monkeypatch.delenv("GHOSTLINES_PROMPT", raising=False)
    monkeypatch.setenv("GHOSTLINES_LORA_WORDS", "Coloring Book")  # SDXL-only: never added to FLUX's prompt
    images = generate.from_prompt("a cat", "medium", n=2, seed=5)
    assert [im.size for im in images] == [(768, 768), (768, 768)]
    prompt, kwargs = flux.calls[0]
    assert "a cat" in prompt and "coloring book" in prompt and not prompt.startswith("Coloring Book")
    assert kwargs["num_inference_steps"] == models.FLUX_STEPS and kwargs["guidance_scale"] == 0.0
    assert (kwargs["width"], kwargs["height"]) == (768, 768)
    assert len(flux.calls) == 2  # one draft per seed
    generate.from_prompt("a dog", n=1)
    assert len(flux.calls) == 3  # the pipeline was loaded once and reused


def test_sdxl_stays_the_default_and_gets_the_lora_trigger_words(monkeypatch):
    calls = []

    class FakeSdxl:
        def __call__(self, prompt, **kwargs):
            from PIL import Image

            calls.append((prompt, kwargs))
            return type("Out", (), {"images": [Image.new("RGB", (kwargs["width"], kwargs["height"]), "white")]})()

    fake_torch(monkeypatch)
    monkeypatch.setattr(models, "load_lightning", lambda with_controlnet=False: FakeSdxl())
    monkeypatch.setattr(models, "free_gpu", lambda: None)
    monkeypatch.setattr(generate, "_cache", {})
    monkeypatch.delenv("GHOSTLINES_IMAGE_MODEL", raising=False)
    monkeypatch.setenv("GHOSTLINES_LORA_WORDS", "Coloring Book")
    [image] = generate.from_prompt("a cat", n=1)
    prompt, kwargs = calls[0]
    assert prompt.startswith("Coloring Book, ") and (kwargs["width"], kwargs["height"]) == (1024, 1024)
    assert image.size == (768, 768)
