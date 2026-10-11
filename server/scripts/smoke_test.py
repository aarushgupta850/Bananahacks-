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
import os
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline.prompts import line_art_prompt  # noqa: E402
from scripts.download_models import ENV_FILE, read_env_file  # noqa: E402

BASE_REPO = "stabilityai/stable-diffusion-xl-base-1.0"
LIGHTNING_REPO = "ByteDance/SDXL-Lightning"
LIGHTNING_FILE = "sdxl_lightning_4step_unet.safetensors"
OUT_DIR = SERVER_DIR / "out"
TARGET_SIZE = 768  # all app coordinates are in 768 x 768 space
MAX_IMAGE_BYTES = 300 * 1024  # pipeline images must be 300 KB or less


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate one test image with SDXL-Lightning.")
    parser.add_argument("--subject", default="a fox", help="what to draw, e.g. 'a fox'")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    # Same as download_models.py: HF settings must be in the environment before the HF libraries load.
    env = read_env_file(ENV_FILE)
    if env.get("HF_HOME") and not os.environ.get("HF_HOME"):
        os.environ["HF_HOME"] = env["HF_HOME"]
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    print(f"HF_HOME: {os.environ.get('HF_HOME', '(not set, using the default cache)')}")

    import torch
    from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline, UNet2DConditionModel
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file

    if not torch.cuda.is_available():
        print("CUDA is not available. Check the torch install (it must be a +cu build).")
        return 1
    gpu = torch.cuda.get_device_properties(0)
    vram_gb = gpu.total_memory / 1024**3
    print(f"GPU: {gpu.name}, {vram_gb:.1f} GB VRAM, torch {torch.__version__}")

    start = time.time()
    # Build an empty SDXL UNet from the base config, then fill it with the Lightning weights.
    unet = UNet2DConditionModel.from_config(UNet2DConditionModel.load_config(BASE_REPO, subfolder="unet"))
    unet.load_state_dict(load_file(hf_hub_download(LIGHTNING_REPO, LIGHTNING_FILE)))
    unet = unet.to(torch.float16)

    pipe = StableDiffusionXLPipeline.from_pretrained(
        BASE_REPO, unet=unet, torch_dtype=torch.float16, variant="fp16"
    )
    # Lightning was distilled with "trailing" timesteps; other spacings give blurry results.
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    if vram_gb <= 8.5:
        # 8 GB cards can't hold SDXL all at once: keep each part on the CPU until it is needed.
        pipe.enable_model_cpu_offload()
        print("8 GB card: using model CPU offload")
    else:
        pipe.to("cuda")
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
    gray = image.convert("L")
    dark = sum(1 for p in gray.getdata() if p < 128) / (TARGET_SIZE * TARGET_SIZE)
    size = out_path.stat().st_size
    print(f"Generated in {seconds:.1f} s, peak VRAM {peak_gb:.2f} GB")
    print(f"Saved {out_path} ({size / 1024:.0f} KB, {dark:.1%} dark pixels)")
    if size > MAX_IMAGE_BYTES:
        print("Warning: image is over 300 KB")
    if not 0.005 < dark < 0.4:
        print("Warning: this doesn't look like line art (almost blank, or too dark). Open it and check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
