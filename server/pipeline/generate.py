"""Generates line-art candidates for a subject, from a text prompt or from a photo. Needs the GPU.

Each model is loaded once and kept in a module-level cache, because loading takes about 15 s and a pack
build asks for several images. Only one SDXL pipeline is kept at a time (text or photo): two would not fit
in an 8 GB card's memory budget alongside each other, and a pack only ever uses one path.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from pipeline import models
from pipeline.prompts import line_art_prompt

GEN_SIZE = 1024  # SDXL's native size
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
CONTROLNET_SCALE = 0.8  # how strictly a photo redraw follows the photo's lines (1.0 = strictly)
# The live server's photo path and Happy accidents use img2img instead of the ControlNet: on an 8 GB card the
# UNet and the ControlNet don't fit together, so each ControlNet step swapped them over PCIe (about 8 s a step,
# far past the 23 s limit). img2img reuses the text pipeline and runs as fast as a text prompt.
IMG2IMG_STRENGTH = 0.75  # how much a Happy-accidents redraw may change the canvas (1 = ignore it entirely)
# Photos keep more of their own shape: at 0.75 a side-view F1 car came back as a fighter jet. With 4 Lightning
# steps, 0.6 runs the last 2, which cleans the photo's lines up without inventing a different object.
PHOTO_STRENGTH = 0.6
# A real photo's line map is full of faint texture (grass, fur, shadows, a car park). Redrawn as it is, it came back
# as a gray photo that traced to almost no strokes, so every real photo failed. Only lines at least this strong
# (0-1) are kept, and only connected lines covering at least SPECK_PIXELS pixels (at 1024 x 1024).
LINE_LEVEL = 0.35
SPECK_PIXELS = 120
# The photo is first cropped to its main subject, found by OWLv2 (the prompt if there is one, else these), so the
# outlines come from the subject and not the background: a dog's lesson was mostly the forest behind it.
SUBJECT_QUERIES = ["an animal", "a person", "a car", "a vehicle", "a plant", "a building", "food", "an object"]
SUBJECT_MIN_SCORE = 0.1   # a weaker best match keeps the whole photo
SUBJECT_MARGIN = 0.08     # room around the subject's box, as a share of its size

_cache: dict[str, object] = {}  # "text" or "photo" -> pipeline, "detector" -> LineartDetector


def keep_both_pipelines() -> bool:
    """The live server sets GHOSTLINES_KEEP_BOTH_PIPELINES=1 (run_live.ps1). Then the photo (ControlNet)
    pipeline is built on the text pipeline's weights instead of replacing it."""
    return os.environ.get("GHOSTLINES_KEEP_BOTH_PIPELINES") == "1"


def _pipeline(kind: str):
    """The SDXL-Lightning pipeline for "text", "photo" (with the ControlNet) or "img2img", loaded on first use.
    "img2img" is built on the text pipeline's weights (nothing new to load), and so is "photo" when both are
    kept (keep_both_pipelines). Pipelines that share weights share CPU-offload hooks, so the hooks are
    re-attached whenever a different pipeline runs next."""
    if kind == "img2img":
        base = _pipeline("text")
        if "img2img" not in _cache:
            _cache["img2img"] = models.img2img_pipeline_from(base)
    elif kind not in _cache:
        if not keep_both_pipelines():
            other = "photo" if kind == "text" else "text"
            if other in _cache:  # make room: only one SDXL pipeline at a time
                del _cache[other]
                if other == "text":
                    _cache.pop("img2img", None)  # it shares the text pipeline's weights
                models.free_gpu()
        if kind == "photo" and keep_both_pipelines():
            _cache["photo"] = models.photo_pipeline_from(_pipeline("text"))
        else:
            _cache[kind] = models.load_lightning(with_controlnet=(kind == "photo"))  # comes ready to run
            _cache["active"] = kind
    if _cache.get("active") != kind:
        models.use_pipeline(_cache[kind])
        _cache["active"] = kind
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


def clean_photo_lines(lines: Image.Image) -> Image.Image:
    """The detector's soft line map (white lines on black) as crisp black outlines on white: weak lines (photo
    texture) and small specks are dropped, and the lines are thickened a little, like drawn lines."""
    from scipy import ndimage

    strength = np.asarray(lines.convert("L"), dtype=np.float32) / 255.0
    mask = strength >= LINE_LEVEL
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count:
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        mask = np.isin(labels, 1 + np.flatnonzero(sizes >= SPECK_PIXELS))
    mask = ndimage.binary_dilation(mask, iterations=1)
    return Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L")


def crop_to_subject(photo: Image.Image, subject: str | None) -> Image.Image:
    """The photo cropped to its main subject plus a margin, or the whole photo if no subject is found clearly."""
    import torch

    from pipeline.parts import owl

    processor, model = owl()
    queries = [subject, *SUBJECT_QUERIES] if subject else SUBJECT_QUERIES
    inputs = processor(text=[queries], images=photo.convert("RGB"), return_tensors="pt").to("cuda")
    with torch.no_grad():
        outputs = model(**inputs)
    scores = outputs.logits[0].sigmoid().cpu().numpy().max(axis=1)  # each box's best query
    best = int(scores.argmax())
    if scores[best] < SUBJECT_MIN_SCORE:
        return photo
    # OWLv2 boxes are (cx, cy, w, h), normalized on the photo padded to a square at the bottom and right.
    side = max(photo.size)
    cx, cy, w, h = outputs.pred_boxes[0][best].cpu().numpy() * side
    w, h = w * (1 + 2 * SUBJECT_MARGIN), h * (1 + 2 * SUBJECT_MARGIN)
    box = (max(0, cx - w / 2), max(0, cy - h / 2), min(photo.width, cx + w / 2), min(photo.height, cy + h / 2))
    if box[2] - box[0] < 0.15 * photo.width or box[3] - box[1] < 0.15 * photo.height:
        return photo  # a tiny box is more likely a detail than the subject
    return photo.crop(tuple(round(v) for v in box))


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


def drawing_lines(drawing: Image.Image) -> Image.Image:
    """A user's canvas (dark lines on white or transparent) as ControlNet line art: white lines on black,
    1024 x 1024. No detector needed: the canvas is already line art."""
    rgba = drawing.convert("RGBA")
    flat = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    flat.alpha_composite(rgba)
    lines = ImageOps.invert(flat.convert("L")).convert("RGB")
    return pad_to_square(lines, (0, 0, 0)).resize((GEN_SIZE, GEN_SIZE))


def _img2img(pipe, prompt: str, seed: int, start: Image.Image, strength: float = IMG2IMG_STRENGTH) -> Image.Image:
    import torch

    image = pipe(
        prompt,
        image=start.convert("RGB").resize((GEN_SIZE, GEN_SIZE)),
        strength=strength,  # with 4 Lightning steps, 0.75 runs the last 3
        num_inference_steps=4,
        guidance_scale=0.0,
        generator=torch.Generator("cpu").manual_seed(seed),
    ).images[0]
    return image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def from_photo_fast(photo: Image.Image, subject: str, difficulty: str = "medium", n: int = 3, seed: int = 0) -> list[Image.Image]:
    """The live server's photo path: the photo's cleaned outlines (black on white) redrawn with img2img, n times.
    Follows the photo's shapes a little more loosely than from_photo's ControlNet, but fits in the live time limit.
    (The cleaned outlines themselves were tried as a fallback lesson: on real photos they were fragments and
    background, so a photo with no clean redraw is refused with a hint instead.)"""
    start = clean_photo_lines(photo_lines(photo))
    pipe = _pipeline("img2img")
    prompt = line_art_prompt(subject, difficulty=difficulty)
    # In gray: a redraw keeps a faint tint of the photo (a blue-gray car), which the cleanliness score counts as a
    # colored drawing and rejects, although the lines themselves were fine.
    return [_img2img(pipe, prompt, seed + i, start, strength=PHOTO_STRENGTH).convert("L").convert("RGB") for i in range(n)]


def from_drawing(drawing: Image.Image, subject: str, difficulty: str = "medium", n: int = 3, seed: int = 0) -> list[Image.Image]:
    """n clean drawings of `subject` that follow the lines the user has drawn so far (Happy accidents: a mistake
    becomes part of the new target). img2img from the user's canvas, flattened onto white."""
    start = ImageOps.invert(drawing_lines(drawing).convert("L"))  # back to black lines on white
    pipe = _pipeline("img2img")
    prompt = line_art_prompt(subject, difficulty=difficulty)
    return [_img2img(pipe, prompt, seed + i, start) for i in range(n)]
