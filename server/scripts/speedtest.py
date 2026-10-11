"""A1b speed test: measures the image AI on this PC and finds the cleanest line-art prompt.

Run from the repo root, with server/.venv active, after download_models.py has finished:
    python server/scripts/speedtest.py
    python server/scripts/speedtest.py --photo server/scripts/test_photo.jpg --photo-subject "a mug"

Stages (images go to server/out/speedtest/, which is not committed):
  a. Text to line art: every prompt variant in pipeline/prompts.py, several seeds each, for "a fox".
     Times each image, scores how clean its lines are (pipeline/quality.py) and saves grid.webp,
     one row per variant, so a person can compare them by eye.
  b. Photo to line art: controlnet_aux's LineartDetector pulls the lines out of a photo, then
     SDXL-Lightning plus the MistoLine ControlNet redraws them cleanly with the winning prompt.
  c. Parts: OWLv2 looks for head, body, ear, eye, tail and leg on the cleanest fox and draws the boxes.
Then it writes server/SPEEDTEST.md with the real numbers.
"""

from __future__ import annotations

import argparse
import platform
import statistics
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline import models  # noqa: E402
from pipeline.prompts import CHOSEN, VARIANTS, line_art_prompt  # noqa: E402
from pipeline.quality import line_metrics  # noqa: E402

OUT_DIR = SERVER_DIR / "out" / "speedtest"
REPORT_PATH = SERVER_DIR / "SPEEDTEST.md"
DEFAULT_PHOTO = SERVER_DIR / "scripts" / "test_photo.jpg"
GEN_SIZE = 1024  # SDXL's native size
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
CONTROLNET_SCALE = 0.8  # how strictly the drawing follows the photo's lines (1.0 = strictly)
OWL_LABELS = ["head", "body", "ear", "eye", "tail", "leg"]
OWL_THRESHOLD = 0.1  # OWLv2 scores are low in general; 0.1 is the usual starting point

# Licenses as listed on each model's Hugging Face page (checked by download_models.py --check).
MODEL_LICENSES = [
    (models.BASE_REPO, "text encoders, VAE and config", "CreativeML Open RAIL++-M (openrail++)"),
    (models.LIGHTNING_REPO, "4-step UNet", "CreativeML Open RAIL++-M (openrail++)"),
    (models.CONTROLNET_REPO, "line-art ControlNet, photo path", "CreativeML Open RAIL++-M (openrail++)"),
    (models.ANNOTATORS_REPO, "line-art detector weights", "listed as \"other\" on the model page"),
    (models.OWL_REPO, "part detection", "Apache-2.0"),
]


def reset_peak() -> None:
    import torch

    torch.cuda.reset_peak_memory_stats()


def peak_gb() -> float:
    import torch

    return torch.cuda.max_memory_allocated() / 1024**3


def generator(seed: int):
    import torch

    return torch.Generator("cpu").manual_seed(seed)


def pad_to_square(image: Image.Image, fill: tuple[int, int, int]) -> Image.Image:
    """Centers a non-square image on a square canvas instead of stretching it."""
    side = max(image.size)
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    return canvas


def stage_text(subject: str, seeds: int) -> dict:
    """Stage a: every prompt variant x `seeds` images, timed and scored."""
    reset_peak()
    start = time.perf_counter()
    pipe = models.load_lightning()
    load_s = time.perf_counter() - start
    print(f"[a] SDXL-Lightning loaded in {load_s:.1f} s")

    images = []
    for variant in VARIANTS:
        prompt = line_art_prompt(subject, variant)
        for seed in range(seeds):
            start = time.perf_counter()
            image = pipe(
                prompt,
                num_inference_steps=4,
                guidance_scale=0.0,
                height=GEN_SIZE,
                width=GEN_SIZE,
                generator=generator(seed),
            ).images[0]
            seconds = time.perf_counter() - start
            image = image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
            path = OUT_DIR / f"text-{variant}-{seed}.png"
            image.save(path)
            metrics = line_metrics(image)
            images.append({"variant": variant, "seed": seed, "seconds": seconds, "path": path, **metrics})
            print(
                f"[a] {variant:<9} seed {seed}: {seconds:4.1f} s  score {metrics['score']:6.1f}  "
                f"specks {metrics['specks']:3d}  pieces {metrics['pieces']:3d}  "
                f"gray {metrics['gray_ratio']:.2f}  ink {metrics['ink']:.1%}"
            )

    result = {"load_s": load_s, "images": images, "peak_gb": peak_gb()}
    del pipe
    models.free_gpu()
    return result


def summarize_variants(images: list[dict]) -> list[dict]:
    """Averages the scores per prompt variant, cleanest first."""
    rows = []
    for variant in VARIANTS:
        mine = [i for i in images if i["variant"] == variant]
        rows.append(
            {
                "variant": variant,
                **{k: statistics.mean(i[k] for i in mine) for k in ("score", "specks", "pieces", "gray_ratio", "ink", "seconds")},
                "best": min(mine, key=lambda i: i["score"]),
            }
        )
    return sorted(rows, key=lambda r: r["score"])


def save_grid(images: list[dict], seeds: int, path: Path) -> None:
    """One row per prompt variant, one column per seed, labeled, to compare by eye."""
    thumb, label_h = 256, 22
    grid = Image.new("RGB", (thumb * seeds, (thumb + label_h) * len(VARIANTS)), "white")
    draw = ImageDraw.Draw(grid)
    for row, variant in enumerate(VARIANTS):
        for item in (i for i in images if i["variant"] == variant):
            x, y = item["seed"] * thumb, row * (thumb + label_h)
            grid.paste(Image.open(item["path"]).resize((thumb, thumb)), (x, y + label_h))
            draw.text((x + 4, y + 4), f"{variant} / seed {item['seed']} / score {item['score']:.0f}", fill="black")
    grid.save(path, "WEBP", quality=80)


def stage_photo(photo_path: Path, subject: str, variant: str) -> dict:
    """Stage b: photo -> extracted line art -> clean drawing with the ControlNet."""
    from controlnet_aux import LineartDetector

    reset_peak()
    start = time.perf_counter()
    detector = LineartDetector.from_pretrained(models.ANNOTATORS_REPO).to("cuda")
    detector_load_s = time.perf_counter() - start

    # exif_transpose turns phone photos the right way up.
    photo = ImageOps.exif_transpose(Image.open(photo_path)).convert("RGB")
    pad_to_square(photo, (255, 255, 255)).resize((TARGET_SIZE, TARGET_SIZE)).save(OUT_DIR / "photo-source.png")
    start = time.perf_counter()
    lines = detector(photo, detect_resolution=1024, image_resolution=1024)  # white lines on black
    detect_s = time.perf_counter() - start
    del detector
    models.free_gpu()

    # The ControlNet expects white lines on black, so pad with black (= "no line here").
    control = pad_to_square(lines.convert("RGB"), (0, 0, 0)).resize((GEN_SIZE, GEN_SIZE))
    ImageOps.invert(control).resize((TARGET_SIZE, TARGET_SIZE)).save(OUT_DIR / "photo-lines.png")
    print(f"[b] line art extracted in {detect_s:.1f} s (detector loaded in {detector_load_s:.1f} s)")

    start = time.perf_counter()
    pipe = models.load_lightning(with_controlnet=True)
    load_s = time.perf_counter() - start
    prompt = line_art_prompt(subject, variant)
    start = time.perf_counter()
    image = pipe(
        prompt,
        image=control,
        controlnet_conditioning_scale=CONTROLNET_SCALE,
        num_inference_steps=4,
        guidance_scale=0.0,
        height=GEN_SIZE,
        width=GEN_SIZE,
        generator=generator(0),
    ).images[0]
    generate_s = time.perf_counter() - start
    image = image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    image.save(OUT_DIR / "photo-drawing.png")
    metrics = line_metrics(image)
    print(f"[b] ControlNet pipeline loaded in {load_s:.1f} s, drawing generated in {generate_s:.1f} s")

    result = {
        "detector_load_s": detector_load_s,
        "detect_s": detect_s,
        "load_s": load_s,
        "generate_s": generate_s,
        "prompt": prompt,
        "metrics": metrics,
        "peak_gb": peak_gb(),
    }
    del pipe
    models.free_gpu()
    return result


def stage_parts(image_path: Path) -> dict:
    """Stage c: OWLv2 finds labeled parts on one drawing and draws the boxes."""
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor

    reset_peak()
    start = time.perf_counter()
    processor = Owlv2Processor.from_pretrained(models.OWL_REPO)
    model = Owlv2ForObjectDetection.from_pretrained(models.OWL_REPO).to("cuda").eval()
    load_s = time.perf_counter() - start

    image = Image.open(image_path).convert("RGB")
    start = time.perf_counter()
    inputs = processor(text=[OWL_LABELS], images=image, return_tensors="pt").to("cuda")
    with torch.no_grad():
        outputs = model(**inputs)
    found = processor.post_process_grounded_object_detection(
        outputs, threshold=OWL_THRESHOLD, target_sizes=[(image.height, image.width)], text_labels=[OWL_LABELS]
    )[0]
    torch.cuda.synchronize()
    detect_s = time.perf_counter() - start

    detections = sorted(
        (
            {"label": label, "score": float(score), "box": [round(float(v)) for v in box]}
            for label, score, box in zip(found["text_labels"], found["scores"], found["boxes"])
        ),
        key=lambda d: -d["score"],
    )
    draw = ImageDraw.Draw(image)
    for d in detections:
        draw.rectangle(d["box"], outline=(59, 108, 255), width=3)
        draw.text((d["box"][0] + 4, d["box"][1] + 4), f"{d['label']} {d['score']:.2f}", fill=(59, 108, 255))
    image.save(OUT_DIR / "owl-parts.png")
    print(f"[c] OWLv2 loaded in {load_s:.1f} s, found {len(detections)} parts in {detect_s:.2f} s")

    result = {"load_s": load_s, "detect_s": detect_s, "detections": detections, "peak_gb": peak_gb()}
    del model
    models.free_gpu()
    return result


def write_report(info: dict, text: dict, ranking: list[dict], photo: dict | str, parts: dict | str) -> None:
    """Writes server/SPEEDTEST.md. Every number in it was measured by this run."""
    times = [i["seconds"] for i in text["images"]]
    best = ranking[0]
    lines = [
        "# Speed test (A1b)",
        "",
        f"Measured by `server/scripts/speedtest.py` on {info['date']}. Images are in `server/out/speedtest/` (not committed).",
        "",
        "## Machine",
        "",
        f"- GPU: {info['gpu']}, {info['vram_gb']:.1f} GB VRAM"
        + (" (model CPU offload on)" if info["vram_gb"] <= models.OFFLOAD_VRAM_GB else ""),
        f"- torch {info['torch']}, diffusers {info['diffusers']}, transformers {info['transformers']}, Python {info['python']}",
        "",
        "## Timing",
        "",
        "| Stage | Load | Per image | Peak VRAM |",
        "|---|---|---|---|",
        f"| a. Text to line art (SDXL-Lightning, 4 steps, {GEN_SIZE} px) | {text['load_s']:.1f} s "
        f"| first {times[0]:.1f} s, then median {statistics.median(times[1:] or times):.1f} s | {text['peak_gb']:.2f} GB |",
    ]
    if isinstance(photo, dict):
        lines += [
            f"| b1. Line-art detection (controlnet_aux LineartDetector) | {photo['detector_load_s']:.1f} s | {photo['detect_s']:.1f} s | (in b2) |",
            f"| b2. Photo redraw (SDXL-Lightning + MistoLine ControlNet) | {photo['load_s']:.1f} s | {photo['generate_s']:.1f} s | {photo['peak_gb']:.2f} GB |",
        ]
    else:
        lines.append(f"| b. Photo to line art | failed: {photo} | | |")
    if isinstance(parts, dict):
        lines.append(f"| c. Part detection (OWLv2) | {parts['load_s']:.1f} s | {parts['detect_s']:.2f} s | {parts['peak_gb']:.2f} GB |")
    else:
        lines.append(f"| c. Part detection (OWLv2) | failed: {parts} | | |")

    lines += [
        "",
        f"## Prompt comparison ({info['subject']}, {info['seeds']} seeds each, cleanest first)",
        "",
        "Score from `server/pipeline/quality.py`, lower is cleaner: specks + half the separate pieces "
        "+ 50 x gray-per-ink ratio (shading) + a penalty for solid fills or a blank page.",
        "",
        "| Variant | Score | Specks | Pieces | Gray ratio | Ink | Seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in ranking:
        lines.append(
            f"| {r['variant']} | {r['score']:.1f} | {r['specks']:.1f} | {r['pieces']:.1f} | "
            f"{r['gray_ratio']:.2f} | {r['ink']:.1%} | {r['seconds']:.1f} |"
        )
    lines += [
        "",
        f"Cleanest by score: **{best['variant']}**. `CHOSEN` in `server/pipeline/prompts.py` is currently "
        f"**{CHOSEN}**; set it after checking `server/out/speedtest/grid.webp` by eye.",
        "",
        "```",
        line_art_prompt(info["subject"], best["variant"]),
        "```",
        "",
    ]
    if isinstance(photo, dict):
        m = photo["metrics"]
        lines += [
            f"Photo redraw (`photo-drawing.png`): score {m['score']:.1f}, specks {m['specks']}, "
            f"pieces {m['pieces']}, gray ratio {m['gray_ratio']:.2f}, ink {m['ink']:.1%}.",
            "",
        ]
    if isinstance(parts, dict):
        lines += [f"## Parts found on `{info['parts_image']}` (OWLv2, threshold {OWL_THRESHOLD})", ""]
        if parts["detections"]:
            lines += ["| Label | Score | Box (x0, y0, x1, y1) |", "|---|---|---|"]
            lines += [f"| {d['label']} | {d['score']:.2f} | {tuple(d['box'])} |" for d in parts["detections"]]
        else:
            lines.append("No parts above the threshold.")
        lines.append("")
    lines += ["## Models", "", "| Model | Used for | License |", "|---|---|---|"]
    lines += [f"| [{repo}](https://huggingface.co/{repo}) | {use} | {lic} |" for repo, use, lic in MODEL_LICENSES]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speed test and prompt comparison for the image AI.")
    parser.add_argument("--subject", default="a fox")
    parser.add_argument("--seeds", type=int, default=4, help="images per prompt variant")
    parser.add_argument("--photo", type=Path, default=DEFAULT_PHOTO, help="photo for the photo-to-line-art test")
    parser.add_argument("--photo-subject", default="a mug", help="what the photo shows, e.g. 'a mug'")
    args = parser.parse_args(argv)

    # Check the photo first, so a missing file doesn't surface after minutes of model loading.
    if not args.photo.is_file():
        print(f"No photo at {args.photo}. Save a clear photo of a simple object (a mug or a shoe) there, "
              "or pass --photo <path>.")
        return 1

    print(f"HF_HOME: {models.setup_hf_env() or '(not set, using the default cache)'}")
    import diffusers
    import torch
    import transformers

    gpu, vram_gb = models.gpu_info()
    print(f"GPU: {gpu}, {vram_gb:.1f} GB VRAM, torch {torch.__version__}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    info = {
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "gpu": gpu,
        "vram_gb": vram_gb,
        "torch": torch.__version__,
        "diffusers": diffusers.__version__,
        "transformers": transformers.__version__,
        "python": platform.python_version(),
        "subject": args.subject,
        "seeds": args.seeds,
    }

    text = stage_text(args.subject, args.seeds)
    ranking = summarize_variants(text["images"])
    save_grid(text["images"], args.seeds, OUT_DIR / "grid.webp")
    best_image = ranking[0]["best"]["path"]
    info["parts_image"] = best_image.name

    # Stages b and c are independent of each other: if one fails, record why and keep going.
    failed = False
    try:
        photo = stage_photo(args.photo, args.photo_subject, ranking[0]["variant"])
    except Exception as error:  # noqa: BLE001 - report any failure, then continue
        traceback.print_exc()
        photo, failed = f"{type(error).__name__}: {error}", True
    try:
        parts = stage_parts(best_image)
    except Exception as error:  # noqa: BLE001
        traceback.print_exc()
        parts, failed = f"{type(error).__name__}: {error}", True

    write_report(info, text, ranking, photo, parts)
    print(f"\nCleanest prompt by score: {ranking[0]['variant']} (score {ranking[0]['score']:.1f})")
    print(f"Wrote {REPORT_PATH}")
    print(f"Check by eye: {OUT_DIR / 'grid.webp'}, photo-lines.png, photo-drawing.png, owl-parts.png")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
