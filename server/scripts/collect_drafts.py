"""Generates raw AI drafts exactly as the live server does, to tune the pipeline on real drawings. Needs the GPU.

The live server's packs only keep drafts after frames and stray marks are removed, so they can't show what the
cleanup steps see. This saves the drafts straight from SDXL-Lightning, with the live prompt and seeds, for
compare_drafts.py (which rebuilds lessons from them without the GPU).

    python server/scripts/collect_drafts.py --out server/out/drafts            # the full set
    python server/scripts/collect_drafts.py --out server/out/drafts --extra "a frog,a tractor"
    python server/scripts/collect_drafts.py --out server/out/drafts --batch-test

Stop the live server first: an 8 GB card and a PC without spare RAM can't hold two copies of SDXL.
Each lesson's drafts go to <out>/<variant>/<subject>-<difficulty>-s<seed>/candidate-<i>.webp (lossless, so the
cleanup steps see exactly the pixels SDXL made). A folder already holding all its drafts is skipped, so a run that
stops halfway can simply be started again. Timings go to <out>/results.json.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from pipeline import models  # noqa: E402

N_DRAFTS = 3  # as LIVE_CANDIDATES in api.py
# What judges and visitors are likely to type: animals, vehicles, food, objects, buildings and a few fantasy ones.
MEDIUM = [
    "a cat", "a dog", "a horse", "an elephant", "an owl", "a fish", "a turtle", "a butterfly", "a rabbit",
    "a penguin", "a lion", "a dragon", "a dinosaur", "a unicorn", "a robot", "a car", "a bicycle", "an airplane",
    "a rocket", "a sailboat", "a house", "a castle", "a tree", "a flower", "an ice cream cone",
]
SIMPLE = ["a cat", "a dog", "a fish", "a house", "a tree", "a car", "an apple", "a flower"]
DETAILED = ["a cat", "a horse", "a dragon", "a car", "a castle", "a guitar"]
VARIANT_SUBJECTS = ["a cat", "a dog", "an owl", "a horse", "a turtle", "a dragon", "a robot", "a car", "a bicycle",
                    "a house"]
TRIED_VARIANTS = ["icon_plain", "icon_contrast"]  # compared with the live prompt (prompts.CHOSEN)
DRAW_SEEDS = [0, 100]  # medium subjects are drawn twice: seeds 0-2 and 100-102


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def jobs(extra: list[str], chosen: str) -> list[tuple[str, str, str, int]]:
    """(variant, subject, difficulty, first seed) for every lesson to draw, the live prompt first."""
    todo = [(chosen, s, "medium", seed) for seed in DRAW_SEEDS for s in MEDIUM + extra]
    todo += [(chosen, s, "simple", 0) for s in SIMPLE]
    todo += [(chosen, s, "detailed", 0) for s in DETAILED]
    todo += [(v, s, "medium", 0) for v in TRIED_VARIANTS for s in VARIANT_SUBJECTS]
    return todo


def draw(pipe, prompt: str, seeds: list[int], batch: bool):
    """The drafts for these seeds, 768 x 768, as gen.from_prompt makes them. With `batch`, all in one pipeline call
    (one generator per seed, so each draft starts from the same noise as when drawn alone)."""
    import torch
    from PIL import Image

    from pipeline import generate as gen

    if not batch:
        return [gen._generate(pipe, prompt, seed) for seed in seeds]
    images = pipe(
        prompt, num_images_per_prompt=len(seeds), num_inference_steps=4, guidance_scale=0.0,
        height=gen.GEN_SIZE, width=gen.GEN_SIZE,
        generator=[torch.Generator("cpu").manual_seed(seed) for seed in seeds],
    ).images
    return [image.resize((gen.TARGET_SIZE, gen.TARGET_SIZE), Image.LANCZOS) for image in images]


def batch_test(pipe, results: dict) -> None:
    """Times 3 drafts drawn one by one against the same 3 in one batched call, with peak GPU memory, and how far
    the batched drafts differ from the one-by-one ones (largest pixel difference)."""
    import numpy as np
    import torch

    from pipeline.prompts import line_art_prompt

    pipe.enable_vae_slicing()  # decode the batch one image at a time, or the VAE can run out of memory
    rows = []
    for subject in ["a cat", "a car", "a house"]:
        prompt = line_art_prompt(subject)
        row = {"subject": subject}
        for mode in ("one by one", "batched"):
            torch.cuda.reset_peak_memory_stats()
            start = time.perf_counter()
            try:
                images = draw(pipe, prompt, [7, 8, 9], batch=(mode == "batched"))
            except torch.cuda.OutOfMemoryError as error:
                row[mode] = {"error": f"out of memory: {error}"}
                torch.cuda.empty_cache()
                continue
            row[mode] = {"seconds": round(time.perf_counter() - start, 2),
                         "peak_gb": round(torch.cuda.max_memory_allocated() / 1024**3, 2)}
            row[f"{mode} images"] = images
        if "one by one images" in row and "batched images" in row:
            row["max_pixel_diff"] = int(max(
                np.abs(np.asarray(a, np.int16) - np.asarray(b, np.int16)).max()
                for a, b in zip(row.pop("one by one images"), row.pop("batched images"))))
        row.pop("one by one images", None)
        row.pop("batched images", None)
        print("  batch test:", row, flush=True)
        rows.append(row)
    results["batch_test"] = rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=SERVER_DIR / "out" / "drafts")
    parser.add_argument("--extra", default="", help="more medium subjects, comma separated (e.g. from live.log)")
    parser.add_argument("--batch-test", action="store_true", help="also time batched drafts against one by one")
    args = parser.parse_args(argv)

    models.setup_hf_env()  # offline mode and HF_HOME, before the Hugging Face libraries load
    from pipeline import generate as gen
    from pipeline.prompts import CHOSEN, line_art_prompt

    args.out.mkdir(parents=True, exist_ok=True)
    results_path = args.out / "results.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else {"lessons": {}}
    extra = [s.strip() for s in args.extra.split(",") if s.strip()]
    todo = jobs(extra, CHOSEN)
    pipe = gen._pipeline("text")
    started = time.perf_counter()
    for n, (variant, subject, difficulty, seed) in enumerate(todo, start=1):
        folder = args.out / variant / f"{slug(subject)}-{difficulty}-s{seed}"
        if len(list(folder.glob("candidate-*.webp"))) >= N_DRAFTS:
            continue
        folder.mkdir(parents=True, exist_ok=True)
        prompt = line_art_prompt(subject, variant=variant, difficulty=difficulty)
        start = time.perf_counter()
        images = draw(pipe, prompt, [seed + i for i in range(N_DRAFTS)], batch=False)
        seconds = time.perf_counter() - start
        for i, image in enumerate(images):
            image.save(folder / f"candidate-{i}.webp", "WEBP", lossless=True)
        results["lessons"][f"{variant}/{folder.name}"] = {
            "variant": variant, "subject": subject, "difficulty": difficulty, "seeds": [seed, seed + N_DRAFTS - 1],
            "prompt": prompt, "seconds": round(seconds, 2),
        }
        results_path.write_text(json.dumps(results, indent=1))
        print(f"[{n}/{len(todo)}] {variant} {subject} ({difficulty}, seed {seed}): {seconds:.1f} s "
              f"({time.perf_counter() - started:.0f} s so far)", flush=True)
    if args.batch_test:
        batch_test(pipe, results)
        results_path.write_text(json.dumps(results, indent=1))
    print(f"done in {time.perf_counter() - started:.0f} s; drafts in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
