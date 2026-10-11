"""A1b speed test: measures the image AI on this PC and finds the cleanest line-art prompt.

Run from the repo root, with server/.venv active, after download_models.py has finished:
    python server/scripts/speedtest.py                                  # all stages, "a fox"
    python server/scripts/speedtest.py --subjects "a fox,a mug,a house" --seeds 2
    python server/scripts/speedtest.py --stages photo --photo-subject "a mug"   # just the photo test

Stages (images go to server/out/speedtest/, which is not committed):
  text   Text to line art: every prompt variant in pipeline/prompts.py x every subject x several seeds.
         Times each image, scores how clean its lines are (pipeline/quality.py) and saves one
         grid-<subject>.webp per subject (a row per variant) so a person can compare them by eye.
  photo  Photo to line art: controlnet_aux's LineartDetector pulls the lines out of
         server/scripts/test_photo.jpg, then SDXL-Lightning plus the MistoLine ControlNet redraws them
         cleanly with the winning prompt. Skipped (not failed) if there is no photo yet.
  parts  OWLv2 looks for head, body, ear, eye, tail and leg on the cleanest image of the first subject.

Each stage's results are saved in server/out/speedtest/results.json, so a later run of one stage
(e.g. --stages photo once the photo exists) keeps the others. server/SPEEDTEST.md is rewritten from
all saved results after every run.
"""

from __future__ import annotations

import argparse
import json
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
RESULTS_PATH = OUT_DIR / "results.json"
REPORT_PATH = SERVER_DIR / "SPEEDTEST.md"
DEFAULT_PHOTO = SERVER_DIR / "scripts" / "test_photo.jpg"
STAGES = ["text", "photo", "parts"]
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


def slugify(subject: str) -> str:
    """'a coffee mug' -> 'coffee-mug', for file names."""
    words = subject.lower().split()
    if len(words) > 1 and words[0] in ("a", "an", "the"):
        words = words[1:]
    return "-".join(words)


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


# ---------------------------------------------------------------- stage: text


def stage_text(subjects: list[str], seeds: int) -> dict:
    """Every prompt variant x every subject x `seeds` images, timed and scored."""
    reset_peak()
    start = time.perf_counter()
    pipe = models.load_lightning()
    load_s = time.perf_counter() - start
    print(f"[text] SDXL-Lightning loaded in {load_s:.1f} s")

    images = []
    for subject in subjects:
        slug = slugify(subject)
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
                path = OUT_DIR / f"text-{slug}-{variant}-{seed}.png"
                image.save(path)
                metrics = line_metrics(image)
                images.append(
                    {"subject": subject, "variant": variant, "seed": seed, "seconds": seconds, "path": str(path), **metrics}
                )
                print(
                    f"[text] {slug:<8} {variant:<9} seed {seed}: {seconds:4.1f} s  score {metrics['score']:6.1f}  "
                    f"specks {metrics['specks']:3d}  pieces {metrics['pieces']:3d}  "
                    f"gray {metrics['gray_ratio']:.2f}  ink {metrics['ink']:.1%}"
                )
        save_grid([i for i in images if i["subject"] == subject], seeds, OUT_DIR / f"grid-{slug}.webp")

    result = {"status": "ok", "load_s": load_s, "subjects": subjects, "seeds": seeds, "images": images, "peak_gb": peak_gb()}
    del pipe
    models.free_gpu()
    return result


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


def rank_variants(images: list[dict]) -> list[dict]:
    """Averages the scores per prompt variant over all subjects and seeds, cleanest first."""
    rows = []
    for variant in VARIANTS:
        mine = [i for i in images if i["variant"] == variant]
        if not mine:
            continue
        row = {"variant": variant}
        for key in ("score", "specks", "pieces", "gray_ratio", "ink", "seconds"):
            row[key] = statistics.mean(i[key] for i in mine)
        row["by_subject"] = {
            s: statistics.mean(i["score"] for i in mine if i["subject"] == s)
            for s in dict.fromkeys(i["subject"] for i in mine)
        }
        rows.append(row)
    return sorted(rows, key=lambda r: r["score"])


def best_image(images: list[dict], variant: str, subject: str) -> dict:
    return min((i for i in images if i["variant"] == variant and i["subject"] == subject), key=lambda i: i["score"])


# ---------------------------------------------------------------- stage: photo


def stage_photo(photo_path: Path, subject: str, variant: str) -> dict:
    """Photo -> extracted line art -> clean drawing with the ControlNet."""
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
    print(f"[photo] line art extracted in {detect_s:.1f} s (detector loaded in {detector_load_s:.1f} s)")

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
    print(f"[photo] ControlNet pipeline loaded in {load_s:.1f} s, drawing generated in {generate_s:.1f} s")

    result = {
        "status": "ok",
        "detector_load_s": detector_load_s,
        "detect_s": detect_s,
        "load_s": load_s,
        "generate_s": generate_s,
        "subject": subject,
        "variant": variant,
        "metrics": metrics,
        "peak_gb": peak_gb(),
    }
    del pipe
    models.free_gpu()
    return result


# ---------------------------------------------------------------- stage: parts


def stage_parts(image_path: Path) -> dict:
    """OWLv2 finds labeled parts on one drawing and draws the boxes."""
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
    print(f"[parts] OWLv2 loaded in {load_s:.1f} s, found {len(detections)} parts in {detect_s:.2f} s")

    result = {
        "status": "ok",
        "image": Path(image_path).name,
        "load_s": load_s,
        "detect_s": detect_s,
        "detections": detections,
        "peak_gb": peak_gb(),
    }
    del model
    models.free_gpu()
    return result


# ---------------------------------------------------------------- report


def write_report(results: dict) -> None:
    """Writes server/SPEEDTEST.md from all saved results. Every number in it was measured."""
    info = results["info"]
    text, photo, parts = results.get("text"), results.get("photo"), results.get("parts")
    lines = [
        "# Speed test (A1b)",
        "",
        f"Measured by `server/scripts/speedtest.py`, last run {info['date']}. "
        "Images are in `server/out/speedtest/` (not committed).",
        "",
        "## Machine",
        "",
        f"- GPU: {info['gpu']}, {info['vram_gb']:.1f} GB VRAM"
        + (" (model CPU offload on)" if info["vram_gb"] <= models.OFFLOAD_VRAM_GB else ""),
        f"- torch {info['torch']}, diffusers {info['diffusers']}, transformers {info['transformers']}, "
        f"Python {info['python']}",
        "",
        "## Timing",
        "",
        "| Stage | Load | Per image | Peak VRAM |",
        "|---|---|---|---|",
    ]
    if text and text["status"] == "ok":
        times = [i["seconds"] for i in text["images"]]
        lines.append(
            f"| Text to line art (SDXL-Lightning, 4 steps, {GEN_SIZE} px) | {text['load_s']:.1f} s "
            f"| first {times[0]:.1f} s, then median {statistics.median(times[1:] or times):.1f} s "
            f"({len(times)} images) | {text['peak_gb']:.2f} GB |"
        )
    else:
        lines.append(f"| Text to line art | {status_text(text)} | | |")
    if photo and photo["status"] == "ok":
        lines += [
            f"| Line-art detection (controlnet_aux LineartDetector) | {photo['detector_load_s']:.1f} s "
            f"| {photo['detect_s']:.1f} s | (in the row below) |",
            f"| Photo redraw (SDXL-Lightning + MistoLine ControlNet) | {photo['load_s']:.1f} s "
            f"| {photo['generate_s']:.1f} s | {photo['peak_gb']:.2f} GB |",
        ]
    else:
        lines.append(f"| Photo to line art | {status_text(photo)} | | |")
    if parts and parts["status"] == "ok":
        lines.append(
            f"| Part detection (OWLv2) | {parts['load_s']:.1f} s | {parts['detect_s']:.2f} s | {parts['peak_gb']:.2f} GB |"
        )
    else:
        lines.append(f"| Part detection (OWLv2) | {status_text(parts)} | | |")

    if text and text["status"] == "ok":
        ranking = rank_variants(text["images"])
        subjects = text["subjects"]
        lines += [
            "",
            f"## Prompt comparison ({len(subjects)} subjects x {text['seeds']} seeds per variant, cleanest first)",
            "",
            "Score from `server/pipeline/quality.py`, lower is cleaner: specks + half the separate pieces "
            "+ 50 x gray-per-ink ratio (shading) + a penalty for solid fills or a blank page.",
            "",
            "| Variant | Score | Specks | Pieces | Gray ratio | Ink | Seconds |",
            "|---|---|---|---|---|---|---|",
        ]
        lines += [
            f"| {r['variant']} | {r['score']:.1f} | {r['specks']:.1f} | {r['pieces']:.1f} | "
            f"{r['gray_ratio']:.2f} | {r['ink']:.1%} | {r['seconds']:.1f} |"
            for r in ranking
        ]
        if len(subjects) > 1:
            lines += [
                "",
                "Mean score per subject:",
                "",
                "| Variant | " + " | ".join(slugify(s) for s in subjects) + " |",
                "|---|" + "---|" * len(subjects),
            ]
            lines += [
                f"| {r['variant']} | " + " | ".join(f"{r['by_subject'][s]:.1f}" for s in subjects) + " |"
                for r in ranking
            ]
        best = ranking[0]["variant"]
        lines += [
            "",
            f"Cleanest by score: **{best}**. `CHOSEN` in `server/pipeline/prompts.py` is **{CHOSEN}**; "
            "set it after checking the grid-*.webp images by eye.",
            "",
            "```",
            VARIANTS[best],
            "```",
        ]
    if photo and photo["status"] == "ok":
        m = photo["metrics"]
        lines += [
            "",
            f"Photo redraw of {photo['subject']} with the {photo['variant']} prompt (`photo-drawing.png`): "
            f"score {m['score']:.1f}, specks {m['specks']}, pieces {m['pieces']}, "
            f"gray ratio {m['gray_ratio']:.2f}, ink {m['ink']:.1%}.",
        ]
    if parts and parts["status"] == "ok":
        lines += ["", f"## Parts found on `{parts['image']}` (OWLv2, threshold {OWL_THRESHOLD})", ""]
        if parts["detections"]:
            lines += ["| Label | Score | Box (x0, y0, x1, y1) |", "|---|---|---|"]
            lines += [f"| {d['label']} | {d['score']:.2f} | {tuple(d['box'])} |" for d in parts["detections"]]
        else:
            lines.append("No parts above the threshold.")
    lines += ["", "## Models", "", "| Model | Used for | License |", "|---|---|---|"]
    lines += [f"| [{repo}](https://huggingface.co/{repo}) | {use} | {lic} |" for repo, use, lic in MODEL_LICENSES]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def status_text(stage: dict | None) -> str:
    if not stage:
        return "not run yet"
    return f"{stage['status']}: {stage.get('message', '')}"


# ---------------------------------------------------------------- main


def run_stage(fn, *args) -> dict:
    """Runs one stage; a failure is recorded with its reason instead of stopping the other stages."""
    try:
        return fn(*args)
    except Exception as error:  # noqa: BLE001 - report any failure, then continue
        traceback.print_exc()
        return {"status": "failed", "message": f"{type(error).__name__}: {error}"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speed test and prompt comparison for the image AI.")
    parser.add_argument("--subjects", default="a fox", help="comma-separated, e.g. 'a fox,a mug,a house'")
    parser.add_argument("--seeds", type=int, default=4, help="images per prompt variant and subject")
    parser.add_argument("--stages", default=",".join(STAGES), help=f"comma-separated, from {STAGES}")
    parser.add_argument("--photo", type=Path, default=DEFAULT_PHOTO, help="photo for the photo stage")
    parser.add_argument("--photo-subject", default="a mug", help="what the photo shows, e.g. 'a mug'")
    args = parser.parse_args(argv)
    subjects = [s.strip() for s in args.subjects.split(",") if s.strip()]
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    if unknown := set(stages) - set(STAGES):
        parser.error(f"unknown stages {sorted(unknown)}; choose from {STAGES}")

    print(f"HF_HOME: {models.setup_hf_env() or '(not set, using the default cache)'}")
    import diffusers
    import torch
    import transformers

    gpu, vram_gb = models.gpu_info()
    print(f"GPU: {gpu}, {vram_gb:.1f} GB VRAM, torch {torch.__version__}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Keep the results of stages not run this time.
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8")) if RESULTS_PATH.exists() else {}
    results["info"] = {
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "gpu": gpu,
        "vram_gb": vram_gb,
        "torch": torch.__version__,
        "diffusers": diffusers.__version__,
        "transformers": transformers.__version__,
        "python": platform.python_version(),
    }

    def save() -> None:  # after every stage, so a crash later doesn't lose finished work
        RESULTS_PATH.write_text(json.dumps(results, indent=1), encoding="utf-8")

    if "text" in stages:
        results["text"] = run_stage(stage_text, subjects, args.seeds)
        save()
    text_ok = results.get("text", {}).get("status") == "ok"
    ranking = rank_variants(results["text"]["images"]) if text_ok else []
    winner = ranking[0]["variant"] if ranking else CHOSEN

    if "photo" in stages:
        if args.photo.is_file():
            results["photo"] = run_stage(stage_photo, args.photo, args.photo_subject, winner)
        else:
            print(f"[photo] skipped: no photo at {args.photo}")
            results["photo"] = {"status": "skipped", "message": f"no photo at {args.photo.name} yet"}
        save()

    if "parts" in stages:
        if text_ok:
            first = results["text"]["subjects"][0]
            image = best_image(results["text"]["images"], winner, first)["path"]
            results["parts"] = run_stage(stage_parts, Path(image))
        else:
            results["parts"] = {"status": "skipped", "message": "needs a successful text stage first"}
        save()

    write_report(results)
    if ranking:
        print(f"\nCleanest prompt by score: {winner} (score {ranking[0]['score']:.1f})")
    print(f"Wrote {REPORT_PATH}")
    print(f"Check by eye in {OUT_DIR}: grid-*.webp, photo-lines.png, photo-drawing.png, owl-parts.png")
    failed = [name for name in STAGES if results.get(name, {}).get("status") == "failed" and name in stages]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
