"""A1b speed test: measures the image AI on this PC and finds the cleanest line-art prompt.

Run from the repo root, with server/.venv active, after download_models.py has finished:
    python server/scripts/speedtest.py                                  # all stages, "a fox"
    python server/scripts/speedtest.py --subjects "a fox,a mug,a house" --seeds 2
    python server/scripts/speedtest.py --variants icon,icon_clean --stages text,parts   # adds to earlier runs
    python server/scripts/speedtest.py --stages photo --photo-subject "a mug"   # just the photo test

Stages (images go to server/out/speedtest/, which is not committed):
  text   Text to line art: every prompt variant in pipeline/prompts.py x every subject x several seeds.
         Times each image, scores how clean its lines are (pipeline/quality.py) and saves one
         grid-<subject>.webp per subject (a row per variant) so a person can compare them by eye.
  photo  Photo to line art: controlnet_aux's LineartDetector pulls the lines out of
         server/scripts/test_photo.jpg, then SDXL-Lightning plus the MistoLine ControlNet redraws them
         cleanly with the winning prompt. Skipped (not failed) if there is no photo yet.
  parts  OWLv2 looks for each subject's parts (PART_LABELS) on its cleanest drawing.

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
# Parts to look for per subject: the same lists the pack builder uses.
from pipeline.parts import PART_LABELS  # noqa: E402

OWL_THRESHOLD = 0.1  # OWLv2 scores are low in general; 0.1 is the usual starting point
OWL_THRESHOLD_LOW = 0.05  # also drawn (in orange), to see whether a lower threshold would help
REJECTED_SCORE = 1000  # quality.py adds 1000 for a blank page or a colored drawing

# What the speed-test images showed when checked by eye (the scores can't see all of this).
EYE_NOTES = [
    "baseline, playbook and kids: detailed illustrations with fur/feather hatching, frames and backgrounds; "
    "too hard for a beginner to copy.",
    "icon: bold, uniform outlines, the first usable style; but some head-only busts, a brand-like swoosh "
    "on sneakers, garbled text on a house and solid black fills.",
    "icon_clean (CHOSEN): whole bodies for cat, fox and bird, no garbled text, no cartoon faces; picked by eye "
    "for 7 of 8 subjects. One fox seed came out in full color, which led to quality.py's color reject.",
    "icon_mono: 'black and white' removed color but made drawings more detailed (fur, fills); 'no frame' did "
    "not remove circle frames and added rectangular ones on some seeds. Rejected.",
    "Backgrounds are light gray (about #d8 to #e0), not white, in every variant: tracing must threshold first.",
    "OWLv2 parts: subject-qualified labels ('cat head') score far higher than plain ones ('head'). Distinctive "
    "parts (handle, beak, chimney, door, tail) are reliable; paired parts return only one box (one ear, one eye); "
    "a few boxes are wrong (bird 'head' = whole bird, fish 'mouth' on a fin, sneaker 'heel' = whole upper).",
]

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


def stage_text(subjects: list[str], seeds: int, variants: list[str], earlier: list[dict]) -> dict:
    """Every chosen prompt variant x every subject x `seeds` images, timed and scored.

    Images from earlier runs are kept unless this run makes the same (subject, variant, seed),
    so a follow-up run of a few variants adds to the first comparison instead of replacing it.
    """
    reset_peak()
    start = time.perf_counter()
    pipe = models.load_lightning()
    load_s = time.perf_counter() - start
    print(f"[text] SDXL-Lightning loaded in {load_s:.1f} s")

    images = []
    for subject in subjects:
        slug = slugify(subject)
        for variant in variants:
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
                    f"[text] {slug:<8} {variant:<10} seed {seed}: {seconds:4.1f} s  score {metrics['score']:6.1f}  "
                    f"specks {metrics['specks']:3d}  pieces {metrics['pieces']:3d}  "
                    f"gray {metrics['gray_ratio']:.2f}  color {metrics['color']:.2f}  ink {metrics['ink']:.1%}"
                )
    del pipe
    models.free_gpu()

    made = {(i["subject"], i["variant"], i["seed"]) for i in images}
    merged = [i for i in earlier if (i["subject"], i["variant"], i["seed"]) not in made] + images
    all_subjects = list(dict.fromkeys([i["subject"] for i in merged]))
    for subject in subjects:
        save_grid([i for i in merged if i["subject"] == subject], OUT_DIR / f"grid-{slugify(subject)}.webp")
    return {
        "status": "ok",
        "load_s": load_s,
        "run_times": [i["seconds"] for i in images],  # this run only, for the timing table
        "subjects": all_subjects,
        "images": merged,
        "peak_gb": peak_gb(),
    }


def save_grid(images: list[dict], path: Path) -> None:
    """One row per prompt variant, one column per seed, labeled, to compare by eye."""
    thumb, label_h = 256, 22
    variants = [v for v in VARIANTS if any(i["variant"] == v for i in images)]
    columns = max(i["seed"] for i in images) + 1
    grid = Image.new("RGB", (thumb * columns, (thumb + label_h) * len(variants)), "white")
    draw = ImageDraw.Draw(grid)
    for row, variant in enumerate(variants):
        for item in (i for i in images if i["variant"] == variant):
            x, y = item["seed"] * thumb, row * (thumb + label_h)
            grid.paste(Image.open(item["path"]).resize((thumb, thumb)), (x, y + label_h))
            draw.text((x + 4, y + 4), f"{variant} / seed {item['seed']} / score {item['score']:.0f}", fill="black")
    grid.save(path, "WEBP", quality=80)


def rank_variants(images: list[dict]) -> list[dict]:
    """Summarizes each prompt variant, cleanest first.

    Ranked by "best of N": for each subject take the variant's best seed, then average over subjects.
    That is how the pack builder uses a prompt (generate several candidates, keep the cleanest), so
    one rejected seed doesn't sink a variant the way it would with a plain mean.
    """
    rows = []
    for variant in VARIANTS:
        mine = [i for i in images if i["variant"] == variant]
        if not mine:
            continue
        row = {"variant": variant, "count": len(mine)}
        for key in ("score", "specks", "pieces", "gray_ratio", "color", "ink", "seconds"):
            row[key] = statistics.mean(i[key] for i in mine)
        row["median"] = statistics.median(i["score"] for i in mine)
        row["rejected"] = sum(i["score"] >= REJECTED_SCORE for i in mine)
        row["by_subject"] = {
            s: min(i["score"] for i in mine if i["subject"] == s)
            for s in dict.fromkeys(i["subject"] for i in mine)
        }
        row["best_of_n"] = statistics.mean(row["by_subject"].values())
        rows.append(row)
    return sorted(rows, key=lambda r: r["best_of_n"])


def best_image(images: list[dict], variant: str, subject: str) -> dict:
    """The subject's cleanest image with this variant (or with any variant, if it has none)."""
    mine = [i for i in images if i["subject"] == subject]
    return min([i for i in mine if i["variant"] == variant] or mine, key=lambda i: i["score"])


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


def best_per_query(logits, pred_boxes, size: int) -> list[tuple[float, list[int]]]:
    """For each text query, OWLv2's highest-scoring box: (score 0-1, [x0, y0, x1, y1] in pixels).

    Read straight from the raw outputs instead of a thresholded result, so we also see how close
    a part came when it scored below the threshold. Boxes come as normalized (cx, cy, w, h) on a
    square image, which ours is.
    """
    scores = logits[0].sigmoid()  # (boxes, queries)
    best = []
    for q in range(scores.shape[1]):
        i = int(scores[:, q].argmax())
        cx, cy, w, h = (float(v) * size for v in pred_boxes[0, i])
        best.append((float(scores[i, q]), [round(cx - w / 2), round(cy - h / 2), round(cx + w / 2), round(cy + h / 2)]))
    return best


def stage_parts(targets: list[tuple[str, Path]]) -> dict:
    """OWLv2 looks for each subject's parts on its cleanest drawing and draws the boxes it finds."""
    import torch
    from transformers import Owlv2ForObjectDetection, Owlv2Processor

    reset_peak()
    start = time.perf_counter()
    processor = Owlv2Processor.from_pretrained(models.OWL_REPO)
    model = Owlv2ForObjectDetection.from_pretrained(models.OWL_REPO).to("cuda").eval()
    load_s = time.perf_counter() - start

    subjects, detect_times = [], []
    for subject, image_path in targets:
        slug = slugify(subject)
        labels = PART_LABELS.get(slug, ["head", "body"])
        # Two phrasings per part, to see which one OWLv2 understands better on line art.
        queries = labels + [f"{slug} {label}" for label in labels]
        image = Image.open(image_path).convert("RGB")
        start = time.perf_counter()
        inputs = processor(text=[queries], images=image, return_tensors="pt").to("cuda")
        with torch.no_grad():
            outputs = model(**inputs)
        best = best_per_query(outputs.logits, outputs.pred_boxes, image.width)
        torch.cuda.synchronize()
        detect_times.append(time.perf_counter() - start)

        parts = []
        draw = ImageDraw.Draw(image)
        for n, label in enumerate(labels):
            plain, qualified = best[n], best[n + len(labels)]
            score, box = max(plain, qualified, key=lambda b: b[0])
            parts.append({"label": label, "plain": plain[0], "qualified": qualified[0], "box": box})
            if score >= OWL_THRESHOLD_LOW:
                color = (59, 108, 255) if score >= OWL_THRESHOLD else (242, 122, 94)
                draw.rectangle(box, outline=color, width=3)
                draw.text((box[0] + 4, box[1] + 4), f"{label} {score:.3f}", fill=color)
        image.save(OUT_DIR / f"owl-{slug}.png")
        found = sum(max(p["plain"], p["qualified"]) >= OWL_THRESHOLD for p in parts)
        print(f"[parts] {slug:<8} {found}/{len(labels)} parts at {OWL_THRESHOLD}: "
              + ", ".join(f"{p['label']} {max(p['plain'], p['qualified']):.3f}" for p in parts))
        subjects.append({"subject": subject, "image": Path(image_path).name, "parts": parts})

    result = {
        "status": "ok",
        "load_s": load_s,
        "detect_s": statistics.mean(detect_times),
        "subjects": subjects,
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
        times = text.get("run_times") or [i["seconds"] for i in text["images"]]
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
    if parts and parts["status"] == "ok" and "subjects" in parts:
        lines.append(
            f"| Part detection (OWLv2, per image) | {parts['load_s']:.1f} s | {parts['detect_s']:.2f} s | {parts['peak_gb']:.2f} GB |"
        )
    else:
        lines.append(f"| Part detection (OWLv2) | {status_text(parts)} | | |")

    if text and text["status"] == "ok":
        ranking = rank_variants(text["images"])
        subjects = text["subjects"]
        lines += [
            "",
            f"## Prompt comparison ({len(subjects)} subjects, cleanest first)",
            "",
            "Score from `server/pipeline/quality.py`, lower is cleaner: specks + half the separate pieces "
            "+ 50 x gray-per-ink ratio (shading) + penalties for solid fills, a blank page or color "
            f"(an image scoring {REJECTED_SCORE}+ is rejected). Earlier runs' images are re-scored with the current "
            "quality.py, so every variant is judged the same way. Ranked by best of N: each subject's best seed, "
            "averaged over subjects, because the pack builder keeps the cleanest of several candidates.",
            "",
            "| Variant | Images | Best of N | Median | Mean | Rejected | Gray ratio | Color | Seconds |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        lines += [
            f"| {r['variant']} | {r['count']} | {r['best_of_n']:.1f} | {r['median']:.1f} | {r['score']:.1f} | "
            f"{r['rejected']} | {r['gray_ratio']:.2f} | {r['color']:.2f} | {r['seconds']:.1f} |"
            for r in ranking
        ]
        if len(subjects) > 1:
            lines += [
                "",
                "Best score per subject (the candidate the pack builder would keep):",
                "",
                "| Variant | " + " | ".join(slugify(s) for s in subjects) + " |",
                "|---|" + "---|" * len(subjects),
            ]
            lines += [
                f"| {r['variant']} | "
                + " | ".join(f"{r['by_subject'][s]:.1f}" if s in r["by_subject"] else "-" for s in subjects)
                + " |"
                for r in ranking
            ]
        best = ranking[0]["variant"]
        lines += [
            "",
            f"Cleanest by best-of-N score: **{best}**. Chosen prompt (`CHOSEN` in `server/pipeline/prompts.py`): "
            f"**{CHOSEN}**, also checked by eye in the grid-*.webp images:",
            "",
            "```",
            VARIANTS[CHOSEN],
            "```",
            "",
            "## Checked by eye",
            "",
        ]
        lines += [f"- {note}" for note in EYE_NOTES]
    if photo and photo["status"] == "ok":
        m = photo["metrics"]
        lines += [
            "",
            f"Photo redraw of {photo['subject']} with the {photo['variant']} prompt (`photo-drawing.png`): "
            f"score {m['score']:.1f}, specks {m['specks']}, pieces {m['pieces']}, "
            f"gray ratio {m['gray_ratio']:.2f}, ink {m['ink']:.1%}.",
        ]
    if parts and parts["status"] == "ok" and "subjects" in parts:
        lines += [
            "",
            "## Parts (OWLv2 on each subject's cleanest drawing)",
            "",
            f"Best score per part, for the plain label (\"head\") and the subject-qualified one (\"fox head\"). "
            f"Found = best score at least {OWL_THRESHOLD}; boxes are drawn in `owl-<subject>.png` "
            f"(blue at {OWL_THRESHOLD} or more, orange from {OWL_THRESHOLD_LOW}).",
            "",
            "| Subject | Found | Part scores (plain / qualified) |",
            "|---|---|---|",
        ]
        for item in parts["subjects"]:
            found = sum(max(p["plain"], p["qualified"]) >= OWL_THRESHOLD for p in item["parts"])
            scores = ", ".join(f"{p['label']} {p['plain']:.3f} / {p['qualified']:.3f}" for p in item["parts"])
            lines.append(f"| {slugify(item['subject'])} (`{item['image']}`) | {found}/{len(item['parts'])} | {scores} |")
    elif parts and parts["status"] == "ok":
        lines += ["", "Part results are from an older version of this script; rerun with --stages parts."]
    lines += ["", "## Models", "", "| Model | Used for | License |", "|---|---|---|"]
    lines += [f"| [{repo}](https://huggingface.co/{repo}) | {use} | {lic} |" for repo, use, lic in MODEL_LICENSES]
    # newline="\n" so the committed report has the same line endings on Windows as everywhere else.
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


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
    parser.add_argument("--variants", default=",".join(VARIANTS), help="comma-separated prompt variants to generate")
    parser.add_argument("--stages", default=",".join(STAGES), help=f"comma-separated, from {STAGES}")
    parser.add_argument("--photo", type=Path, default=DEFAULT_PHOTO, help="photo for the photo stage")
    parser.add_argument("--photo-subject", default="a mug", help="what the photo shows, e.g. 'a mug'")
    args = parser.parse_args(argv)
    subjects = [s.strip() for s in args.subjects.split(",") if s.strip()]
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    if unknown := set(stages) - set(STAGES):
        parser.error(f"unknown stages {sorted(unknown)}; choose from {STAGES}")
    if unknown := set(variants) - set(VARIANTS):
        parser.error(f"unknown variants {sorted(unknown)}; choose from {list(VARIANTS)}")

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

    # Re-score images from earlier runs with the current quality.py (its checks may have changed since).
    if results.get("text", {}).get("status") == "ok":
        for item in results["text"]["images"]:
            if Path(item["path"]).is_file():
                item.update(line_metrics(Image.open(item["path"])))

    def save() -> None:  # after every stage, so a crash later doesn't lose finished work
        RESULTS_PATH.write_text(json.dumps(results, indent=1), encoding="utf-8")

    if "text" in stages:
        earlier = results.get("text", {}).get("images", []) if results.get("text", {}).get("status") == "ok" else []
        results["text"] = run_stage(stage_text, subjects, args.seeds, variants, earlier)
        save()
    text_ok = results.get("text", {}).get("status") == "ok"
    ranking = rank_variants(results["text"]["images"]) if text_ok else []
    # The photo and parts stages use the chosen prompt, since that's what the pack builder will use.

    if "photo" in stages:
        if args.photo.is_file():
            results["photo"] = run_stage(stage_photo, args.photo, args.photo_subject, CHOSEN)
        else:
            print(f"[photo] skipped: no photo at {args.photo}")
            results["photo"] = {"status": "skipped", "message": f"no photo at {args.photo.name} yet"}
        save()

    if "parts" in stages:
        if text_ok:
            images = results["text"]["images"]
            targets = [(s, Path(best_image(images, CHOSEN, s)["path"])) for s in results["text"]["subjects"]]
            results["parts"] = run_stage(stage_parts, targets)
        else:
            results["parts"] = {"status": "skipped", "message": "needs a successful text stage first"}
        save()

    write_report(results)
    if ranking:
        print(f"\nCleanest by best-of-N score: {ranking[0]['variant']} ({ranking[0]['best_of_n']:.1f}); chosen: {CHOSEN}")
    print(f"Wrote {REPORT_PATH}")
    print(f"Check by eye in {OUT_DIR}: grid-*.webp, owl-*.png, photo-lines.png, photo-drawing.png")
    failed = [name for name in STAGES if results.get(name, {}).get("status") == "failed" and name in stages]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
