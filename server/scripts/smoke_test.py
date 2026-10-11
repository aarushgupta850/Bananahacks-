"""GPU smoke test: generates one line-art image with SDXL-Lightning, to prove the setup works.

Run from the repo root, with server/.venv active, after download_models.py has finished:
    python server/scripts/smoke_test.py
    python server/scripts/smoke_test.py --subject "a coffee mug" --seed 7

It loads the SDXL base pipeline, swaps in the SDXL-Lightning 4-step UNet, and generates with
4 steps and guidance 0 (the settings Lightning was trained for). The image is resized to the
768 x 768 target space and saved as webp in server/out/ (not committed).

It only reads the local Hugging Face cache (HF_HUB_OFFLINE), so a missing file fails fast instead
of starting a download.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline import models  # noqa: E402
from pipeline.prompts import line_art_prompt  # noqa: E402
from pipeline.quality import line_metrics  # noqa: E402

OUT_DIR = SERVER_DIR / "out"
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
MAX_IMAGE_BYTES = 300 * 1024  # pipeline images must be 300 KB or less


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate one test image with SDXL-Lightning.")
    parser.add_argument("--subject", default="a fox", help="what to draw, e.g. 'a fox'")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    # HF settings must be in the environment before the HF libraries load.
    print(f"HF_HOME: {models.setup_hf_env() or '(not set, using the default cache)'}")
    import torch

    try:
        gpu, vram_gb = models.gpu_info()
    except RuntimeError as error:
        print(error)
        return 1
    print(f"GPU: {gpu}, {vram_gb:.1f} GB VRAM, torch {torch.__version__}")
    if vram_gb <= models.OFFLOAD_VRAM_GB:
        print("8 GB card: using model CPU offload")

    start = time.time()
    pipe = models.load_lightning()
    print(f"Loaded in {time.time() - start:.1f} s")

    prompt = line_art_prompt(args.subject)
    print(f"Prompt: {prompt}")
    torch.cuda.reset_peak_memory_stats()
    start = time.time()
    image = pipe(
        prompt,
        num_inference_steps=4,
        guidance_scale=0.0,
        generator=torch.Generator("cpu").manual_seed(args.seed),
    ).images[0]
    seconds = time.time() - start
    peak_gb = torch.cuda.max_memory_allocated() / 1024**3

    # SDXL generates at 1024 x 1024; the app works in 768 x 768.
    image = image.resize((TARGET_SIZE, TARGET_SIZE))
    OUT_DIR.mkdir(exist_ok=True)
    slug = "-".join(args.subject.lower().split())
    out_path = OUT_DIR / f"smoke-{slug}-{args.seed}.webp"
    image.save(out_path, "WEBP", quality=85)

    # Rough check that it looks like line art: mostly white page, some dark ink.
    metrics = line_metrics(image)
    dark = metrics["ink"]
    size = out_path.stat().st_size
    print(f"Generated in {seconds:.1f} s, peak VRAM {peak_gb:.2f} GB")
    print(f"Saved {out_path} ({size / 1024:.0f} KB, {dark:.1%} dark pixels, cleanliness score {metrics['score']:.1f})")
    if size > MAX_IMAGE_BYTES:
        print("Warning: image is over 300 KB")
    if not 0.005 < dark < 0.4:
        print("Warning: this doesn't look like line art (almost blank, or too dark). Open it and check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
