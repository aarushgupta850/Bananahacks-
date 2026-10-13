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
from pipeline.prompts import active_variant, line_art_prompt

GEN_SIZE = 1024  # SDXL's native size
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
CONTROLNET_SCALE = 0.8  # how strictly a photo redraw follows the photo's lines (1.0 = strictly)
# Happy accidents uses img2img instead of the ControlNet: on an 8 GB card the UNet and the ControlNet don't fit
# together, so each ControlNet step swapped them over PCIe (about 8 s a step, far past the live 23 s limit).
# img2img reuses the text pipeline and runs as fast as a text prompt.
IMG2IMG_STRENGTH = 0.75  # how much a Happy-accidents redraw may change the canvas (1 = ignore it entirely)
# The live server's photo path names what the photo shows, then draws that from text (see name_subject). Redrawing
# real photos themselves came back as hundreds of broken strokes, so almost every photo was refused.
# OWLv2 scores each of these against the photo; the best one names it. All are things a beginner can draw.
PHOTO_SUBJECTS = [
    # animals
    "a dog", "a cat", "a bird", "a horse", "a cow", "a sheep", "a pig", "a rabbit", "a fish", "a duck", "a chicken",
    "a frog", "a turtle", "a butterfly", "an elephant", "a giraffe", "a lion", "a bear", "a teddy bear",
    # people
    "a face", "a person",
    # vehicles
    "a car", "a bicycle", "a motorcycle", "a bus", "a truck", "a train", "an airplane", "a boat", "a helicopter",
    # around the house
    "a mug", "a cup", "a teapot", "a bottle", "a glass", "a bowl", "a plate", "a spoon", "a chair", "a table",
    "a sofa", "a bed", "a lamp", "a clock", "a vase", "a book", "a pencil", "an umbrella",
    "a key", "a candle",
    # things people carry and wear
    "a shoe", "a sneaker", "a boot", "a hat", "a backpack", "a handbag", "a pair of glasses", "a watch",
    "a t-shirt",
    # technology
    "a phone", "a laptop", "a keyboard", "a computer mouse", "headphones", "a camera", "a television",
    # music, sport and toys
    "a guitar", "a piano", "a ball", "a basketball", "a soccer ball", "a skateboard", "a kite", "a toy",
    # food
    "an apple", "a banana", "an orange", "a pear", "a strawberry", "a pineapple", "a carrot", "a pizza",
    "a cake", "a cupcake", "an ice cream cone", "a donut", "a sandwich",
    # nature and places
    "a flower", "a potted plant", "a tree", "a leaf", "a cactus", "a mushroom", "a house", "a lighthouse",
]
NAME_MIN_SCORE = 0.1  # OWLv2's sigmoid score: a clear object scores about 0.2 to 0.6; under this, nothing is named
NAME_MIN_BOX = 0.15   # a box narrower or shorter than this share of the photo is a detail, not the subject

_cache: dict[str, object] = {}  # "text" or "photo" -> pipeline, "detector" -> LineartDetector


def keep_both_pipelines() -> bool:
    """With GHOSTLINES_KEEP_BOTH_PIPELINES=1 (for a process that builds both kinds of pack), the photo (ControlNet)
    pipeline is built on the text pipeline's weights instead of replacing it."""
    return os.environ.get("GHOSTLINES_KEEP_BOTH_PIPELINES") == "1"


def _pipeline(kind: str):
    """The SDXL-Lightning pipeline for "text", "photo" (with the ControlNet) or "img2img", loaded on first use.
    "img2img" is built on the text pipeline's weights (nothing new to load), and so is "photo" when both are
    kept (keep_both_pipelines). Pipelines that share weights share CPU-offload hooks, so the hooks are
    re-attached whenever a different pipeline runs next."""
    if kind == "flux":  # FLUX.1-schnell (GHOSTLINES_IMAGE_MODEL=flux): its own pipeline, for typed subjects only
        if "flux" not in _cache:
            _cache["flux"] = models.load_flux()  # comes ready to run, with its own CPU-offload hooks
        return _cache["flux"]
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

    if models.is_flux(pipe):
        # FLUX draws at any size: straight at 768 px, which is about half the work of SDXL's 1024 px.
        extra = {"num_inference_steps": models.FLUX_STEPS, "max_sequence_length": 256, **extra}
        size = TARGET_SIZE
    else:
        extra = {"num_inference_steps": models.lightning_steps(), **extra}  # what the Lightning UNet was distilled for
        size = GEN_SIZE
    image = pipe(
        prompt,
        guidance_scale=0.0,  # both Lightning and schnell are trained without classifier-free guidance
        height=size,
        width=size,
        generator=torch.Generator("cpu").manual_seed(seed),
        **extra,
    ).images[0]
    return image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def _generate_batch(pipe, prompt: str, seeds: list[int]) -> list[Image.Image]:
    """One drawing per seed, all from one pipeline call: each starts from its own seed's noise, as when drawn alone
    (the pixels differ a little from drawing them one by one). Used by scripts/collect_drafts.py to time it."""
    import torch

    pipe.vae.enable_slicing()  # decode the drawings one at a time: decoding them together needs far more memory
    images = pipe(
        prompt,
        num_images_per_prompt=len(seeds),
        num_inference_steps=models.lightning_steps(),
        guidance_scale=0.0,
        height=GEN_SIZE,
        width=GEN_SIZE,
        generator=[torch.Generator("cpu").manual_seed(seed) for seed in seeds],
    ).images
    return [image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS) for image in images]


def from_prompt(subject: str, difficulty: str = "medium", n: int = 4, seed: int = 0) -> list[Image.Image]:
    """n candidate drawings of `subject`, 768 x 768, using seeds seed, seed+1, ... so a build can be repeated.
    They are drawn one by one. (In one batch, 3 drafts took 9-11 s instead of 16-17 s in a test script, but in the
    live server, with OWLv2 also on the 8 GB card, a batch of 4 overflowed into shared memory and took 30 s.)
    GHOSTLINES_IMAGE_MODEL picks who draws them: "sdxl" (SDXL-Lightning, the default), "flux" (FLUX.1-schnell, on the
    same GPU) or "openai" (OpenAI's image API, pipeline/openai_images.py, and no local model is loaded)."""
    from pipeline import openai_images

    if openai_images.enabled():
        return openai_images.from_prompt(subject, difficulty, n=n)
    pipe = _pipeline("flux" if models.image_model() == "flux" else "text")
    prompt = line_art_prompt(subject, variant=active_variant(), difficulty=difficulty)
    words = os.environ.get("GHOSTLINES_LORA_WORDS", "").strip()  # a style LoRA's trigger words, e.g. "Coloring Book"
    if words and not models.is_flux(pipe):
        prompt = f"{words}, {prompt}"
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


def best_subject(scores: np.ndarray, boxes: np.ndarray, photo_size: tuple[int, int]) -> tuple[int, float] | None:
    """(index of the best-matching subject, its score) from OWLv2's output, or None if nothing matches well enough.
    scores is (boxes, subjects); boxes is (boxes, 4) as (cx, cy, w, h), normalized on the photo padded to a square.
    Boxes too small to be the photo's subject are ignored (a bottle on a shelf behind the dog), unless every box
    is small. Kept separate from name_subject so it can be tested without the GPU."""
    width, height = photo_size
    side = max(photo_size)
    big = (boxes[:, 2] * side >= NAME_MIN_BOX * width) & (boxes[:, 3] * side >= NAME_MIN_BOX * height)
    if big.any():
        scores = scores[big]
    per_subject = scores.max(axis=0)  # each subject's best box
    best = int(per_subject.argmax())
    if per_subject[best] < NAME_MIN_SCORE:
        return None
    return best, float(per_subject[best])


def name_subject(photo: Image.Image) -> str | None:
    """What the photo shows, from PHOTO_SUBJECTS (e.g. "a mug"), or None if OWLv2 can't tell."""
    import torch

    from pipeline.parts import owl

    processor, model = owl()
    inputs = processor(text=[PHOTO_SUBJECTS], images=photo.convert("RGB"), return_tensors="pt").to("cuda")
    with torch.no_grad():
        outputs = model(**inputs)
    scores = outputs.logits[0].sigmoid().cpu().numpy()  # (boxes, subjects)
    found = best_subject(scores, outputs.pred_boxes[0].cpu().numpy(), photo.size)
    return PHOTO_SUBJECTS[found[0]] if found else None


def from_photo(
    photo: str | Path | Image.Image, subject: str, difficulty: str = "medium", n: int = 4, seed: int = 0
) -> list[Image.Image]:
    """n clean line drawings redrawn from a photo's lines, 768 x 768. `subject` (e.g. "a mug") goes in the prompt.
    `photo` is a file path or an already-opened image (the live server gets photos as bytes)."""
    control = photo_lines(photo)
    pipe = _pipeline("photo")
    prompt = line_art_prompt(subject, variant=active_variant(), difficulty=difficulty)
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
        strength=strength,  # with 4 Lightning steps, 0.75 runs the last 3 (with 8, the last 6)
        num_inference_steps=models.lightning_steps(),
        guidance_scale=0.0,
        generator=torch.Generator("cpu").manual_seed(seed),
    ).images[0]
    return image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def from_drawing(drawing: Image.Image, subject: str, difficulty: str = "medium", n: int = 3, seed: int = 0) -> list[Image.Image]:
    """n clean drawings of `subject` that follow the lines the user has drawn so far (Happy accidents: a mistake
    becomes part of the new target). img2img from the user's canvas, flattened onto white."""
    start = ImageOps.invert(drawing_lines(drawing).convert("L"))  # back to black lines on white
    pipe = _pipeline("img2img")
    prompt = line_art_prompt(subject, variant=active_variant(), difficulty=difficulty)
    return [_img2img(pipe, prompt, seed + i, start) for i in range(n)]
