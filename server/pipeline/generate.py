"""Generates line-art candidates for a subject, from a text prompt or from a photo. Needs the GPU.

Each model is loaded once and kept in a module-level cache, because loading takes about 15 s and a pack
build asks for several images. Only one SDXL pipeline is kept at a time (text or photo): two would not fit
in an 8 GB card's memory budget alongside each other, and a pack only ever uses one path.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageOps

from pipeline import models
from pipeline.prompts import line_art_prompt

GEN_SIZE = 1024  # SDXL's native size
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
CONTROLNET_SCALE = 0.8  # how strictly a photo redraw follows the photo's lines (1.0 = strictly)

_cache: dict[str, object] = {}  # "text" or "photo" -> pipeline, "detector" -> LineartDetector


def keep_both_pipelines() -> bool:
    """The live server sets GHOSTLINES_KEEP_BOTH_PIPELINES=1 (run_live.ps1) on a PC with enough RAM: each
    pipeline's weights wait in system RAM (CPU offload), so keeping both costs RAM, not VRAM, and lets a photo
    request follow a text request without a 20+ s reload that would blow the 23 s answer limit."""
    return os.environ.get("GHOSTLINES_KEEP_BOTH_PIPELINES") == "1"


def _pipeline(kind: str):
    """The SDXL-Lightning pipeline for "text" or "photo" (with the ControlNet), loaded on first use."""
    if kind not in _cache:
        other = "photo" if kind == "text" else "text"
        if other in _cache and not keep_both_pipelines():  # make room: only one SDXL pipeline at a time
            del _cache[other]
            models.free_gpu()
        _cache[kind] = models.load_lightning(with_controlnet=(kind == "photo"))
    return _cache[kind]


def _generate(pipe, prompt: str, seed: int, **extra) -> Image.Image:
    import torch

    image = pipe(
        prompt,
        num_inference_steps=4,  # SDXL-Lightning's 4-step UNet
        guidance_scale=0.0,  # Lightning is trained without classifier-free guidance
        height=GEN_SIZE,
        width=GEN_SIZE,
        generator=torch.Generator("cpu").manual_seed(seed),
        **extra,
    ).images[0]
    return image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def from_prompt(subject: str, difficulty: str = "medium", n: int = 4, seed: int = 0) -> list[Image.Image]:
    """n candidate drawings of `subject`, 768 x 768, using seeds seed, seed+1, ... so a build can be repeated."""
    pipe = _pipeline("text")
    prompt = line_art_prompt(subject, difficulty=difficulty)
    return [_generate(pipe, prompt, seed + i) for i in range(n)]


def pad_to_square(image: Image.Image, fill: tuple[int, int, int]) -> Image.Image:
    """Centers a non-square image on a square canvas instead of stretching it."""
    side = max(image.size)
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    return canvas


def photo_lines(photo: str | Path | Image.Image) -> Image.Image:
    """The photo's line art (white lines on black, 1024 x 1024), as the ControlNet expects it.
    This is only a guide for the redraw: the raw photo is never traced into strokes."""
    if "detector" not in _cache:
        from controlnet_aux import LineartDetector

        _cache["detector"] = LineartDetector.from_pretrained(models.ANNOTATORS_REPO).to("cuda")
    if not isinstance(photo, Image.Image):
        photo = Image.open(photo)
    photo = ImageOps.exif_transpose(photo).convert("RGB")  # phone photos the right way up
    lines = _cache["detector"](photo, detect_resolution=1024, image_resolution=1024)
    # Pad with black, which means "no line here" to the ControlNet.
    return pad_to_square(lines.convert("RGB"), (0, 0, 0)).resize((GEN_SIZE, GEN_SIZE))


def from_photo(
    photo: str | Path | Image.Image, subject: str, difficulty: str = "medium", n: int = 4, seed: int = 0
) -> list[Image.Image]:
    """n clean line drawings redrawn from a photo's lines, 768 x 768. `subject` (e.g. "a mug") goes in the prompt.
    `photo` is a file path or an already-opened image (the live server gets photos as bytes)."""
    control = photo_lines(photo)
    pipe = _pipeline("photo")
    prompt = line_art_prompt(subject, difficulty=difficulty)
    return [
        _generate(pipe, prompt, seed + i, image=control, controlnet_conditioning_scale=CONTROLNET_SCALE)
        for i in range(n)
    ]
