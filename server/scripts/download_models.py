"""Downloads the model weights the pack pipeline needs into the Hugging Face cache (HF_HOME).

Run from the repo root, with server/.venv active:
    python server/scripts/download_models.py           # check every repo, then download
    python server/scripts/download_models.py --check   # check only: repo ids, files, sizes, disk space

How it works:
1. Reads HF_HOME from the .env file in the repo root, so the weights land outside the repo.
2. Checks every repo id on Hugging Face and confirms each file we want exists, before downloading
   anything. If a repo or file is missing, it stops and lists what the repo actually contains.
3. Downloads only the files listed below (not whole repos, which would be 50+ GB).

The weights go into the normal Hugging Face cache, so diffusers, transformers and controlnet_aux
find them later with the same repo ids. Stopping and re-running is safe: finished files are skipped
and unfinished ones resume.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"

# Keep this much disk free after downloading, so the cache drive never fills up completely.
DISK_MARGIN_BYTES = 5 * 1024**3


@dataclass
class Model:
    repo_id: str
    why: str
    # Each entry is a filename pattern (fnmatch style, so "tokenizer/*" means every file in that
    # folder), or a tuple of alternatives: the first alternative that exists in the repo is used.
    patterns: list[str | tuple[str, ...]]


MODELS = [
    Model(
        repo_id="stabilityai/stable-diffusion-xl-base-1.0",
        why="SDXL base pipeline, fp16 files only",
        patterns=[
            "model_index.json",
            "scheduler/*",
            "tokenizer/*",
            "tokenizer_2/*",
            "text_encoder/config.json",
            "text_encoder/model.fp16.safetensors",
            "text_encoder_2/config.json",
            "text_encoder_2/model.fp16.safetensors",
            "unet/config.json",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/config.json",
            "vae/diffusion_pytorch_model.fp16.safetensors",
            # Not used by our pipeline, but diffusers (variant="fp16") treats every fp16 weight file
            # in the repo as required, and refuses to load offline if this alternative VAE is missing.
            "vae_1_0/diffusion_pytorch_model.fp16.safetensors",
        ],
    ),
    Model(
        repo_id="ByteDance/SDXL-Lightning",
        why="SDXL-Lightning 4-step UNet (text to line art in 4 steps)",
        patterns=["sdxl_lightning_4step_unet.safetensors"],
    ),
    Model(
        repo_id="TheMistoAI/MistoLine",
        why="MistoLine: SDXL ControlNet for line art (photo path only)",
        patterns=[
            "config.json",
            ("diffusion_pytorch_model.fp16.safetensors", "diffusion_pytorch_model.safetensors"),
        ],
    ),
    Model(
        repo_id="lllyasviel/Annotators",
        why="Line-art detector weights for controlnet_aux LineartDetector",
        # LineartDetector.from_pretrained loads exactly these two: the fine and the coarse model.
        patterns=["sk_model.pth", "sk_model2.pth"],
    ),
    Model(
        repo_id="google/owlv2-base-patch16-ensemble",
        why="OWLv2: finds the subject in an image from a text label",
        patterns=["*.json", "*.txt", ("model.safetensors", "pytorch_model.bin")],
    ),
]


def read_env_file(path: Path) -> dict[str, str]:
    """Reads KEY=value lines from a .env file. Skips blank lines and # comments."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def pick_files(
    patterns: list[str | tuple[str, ...]], repo_files: list[str]
) -> tuple[list[str], list[str]]:
    """Matches our wanted patterns against a repo's file list.

    Returns (files to download, patterns that matched nothing). An empty second list means
    every file we want exists.
    """
    chosen: list[str] = []
    missing: list[str] = []
    for pattern in patterns:
        alternatives = pattern if isinstance(pattern, tuple) else (pattern,)
        for alternative in alternatives:
            matches = [f for f in repo_files if fnmatch.fnmatch(f, alternative)]
            if matches:
                chosen.extend(m for m in matches if m not in chosen)
                break
        else:
            missing.append(" or ".join(alternatives))
    return chosen, missing


def format_size(num_bytes: int) -> str:
    if num_bytes >= 1024**3:
        return f"{num_bytes / 1024**3:.2f} GB"
    return f"{num_bytes / 1024**2:.1f} MB"


# SDXL-Lightning comes in 4- and 8-step versions. The 8-step one draws cleaner, more even lines (a ball's seams, a
# face) and takes about twice as long per draft. GHOSTLINES_LIGHTNING_STEPS=8 (in the shell, run_live.ps1 or .env)
# switches it on; the default stays 4. Only the version in use is downloaded (each is about 5 GB).
LIGHTNING_STEP_CHOICES = (4, 8)


def lightning_steps(env: dict[str, str] | None = None) -> int:
    """4 or 8, from GHOSTLINES_LIGHTNING_STEPS (the shell wins over the .env file). 4 when it isn't set."""
    value = os.environ.get("GHOSTLINES_LIGHTNING_STEPS") or (env if env is not None else read_env_file(ENV_FILE)).get(
        "GHOSTLINES_LIGHTNING_STEPS") or "4"
    if value.strip() not in {str(n) for n in LIGHTNING_STEP_CHOICES}:
        raise ValueError(f"GHOSTLINES_LIGHTNING_STEPS must be 4 or 8, not {value!r}")
    return int(value)


def lightning_file(steps: int) -> str:
    return f"sdxl_lightning_{steps}step_unet.safetensors"


LIGHTNING_8STEP = Model(
    repo_id="ByteDance/SDXL-Lightning",
    why="SDXL-Lightning 8-step UNet (cleaner lines; used when GHOSTLINES_LIGHTNING_STEPS=8)",
    patterns=[lightning_file(8)],
)


def models_to_fetch(env: dict[str, str]) -> list[Model]:
    """MODELS, plus the 8-step UNet when it's switched on."""
    return MODELS + ([LIGHTNING_8STEP] if lightning_steps(env) == 8 else [])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download the Ghost Lines model weights.")
    parser.add_argument("--check", action="store_true", help="check repos and sizes, download nothing")
    args = parser.parse_args(argv)

    # HF_HOME must be set BEFORE huggingface_hub is imported, because it reads it at import time.
    # A value already set in the shell wins over the .env file.
    env = read_env_file(ENV_FILE)
    for key in ("HF_HOME", "HF_TOKEN"):
        if env.get(key) and not os.environ.get(key):
            os.environ[key] = env[key]
    hf_home = os.environ.get("HF_HOME")
    if not hf_home:
        print(f"HF_HOME is not set. Add a line like HF_HOME=C:\\hf-cache to {ENV_FILE}")
        return 1
    Path(hf_home).mkdir(parents=True, exist_ok=True)

    from huggingface_hub import HfApi, __version__, snapshot_download, try_to_load_from_cache
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    print(f"HF_HOME: {hf_home}  (huggingface_hub {__version__})\n")

    # Step 1: check every repo before downloading anything, so a typo can't waste a long download.
    api = HfApi()
    plan: list[tuple[Model, list[str], int, int]] = []  # model, files, total bytes, bytes to fetch
    errors: list[str] = []
    for model in models_to_fetch(env):
        try:
            info = api.model_info(model.repo_id, files_metadata=True)
        # GatedRepoError is a kind of RepositoryNotFoundError, so it must be caught first.
        except GatedRepoError:
            errors.append(f"{model.repo_id}: gated, accept its license on huggingface.co and set HF_TOKEN")
            continue
        except RepositoryNotFoundError:
            errors.append(f"{model.repo_id}: repo not found (check the id)")
            continue

        sizes = {s.rfilename: s.size or 0 for s in info.siblings}
        files, missing = pick_files(model.patterns, list(sizes))
        if missing:
            errors.append(
                f"{model.repo_id}: no file matches {missing}. The repo contains:\n    "
                + "\n    ".join(sorted(sizes))
            )
            continue

        total = sum(sizes[f] for f in files)
        # Files already in the cache are skipped by the download, so they don't need disk space.
        to_fetch = sum(
            sizes[f] for f in files if not isinstance(try_to_load_from_cache(model.repo_id, f), str)
        )
        license_name = info.card_data.get("license", "not listed") if info.card_data else "not listed"
        print(f"OK  {model.repo_id}  ({model.why})")
        print(f"    license: {license_name}  files: {len(files)}  size: {format_size(total)}"
              f"  still to download: {format_size(to_fetch)}")
        for f in files:
            if sizes[f] >= 100 * 1024**2:  # list the big weight files, skip small configs
                print(f"      {format_size(sizes[f]):>9}  {f}")
        plan.append((model, files, total, to_fetch))

    if errors:
        print("\nStopped before downloading anything:")
        for e in errors:
            print(f"  - {e}")
        return 1

    grand_total = sum(p[2] for p in plan)
    to_fetch = sum(p[3] for p in plan)
    free = shutil.disk_usage(hf_home).free
    print(f"\nTotal: {format_size(grand_total)}, still to download: {format_size(to_fetch)},"
          f" free on the HF_HOME drive: {format_size(free)}")
    if to_fetch + DISK_MARGIN_BYTES > free:
        print("Not enough free disk space. Point HF_HOME at a drive with more room.")
        return 1
    if args.check:
        print("Check passed. Run again without --check to download.")
        return 0

    # Step 2: download. huggingface_hub draws a progress bar for each file.
    start = time.time()
    for i, (model, files, total, _) in enumerate(plan, start=1):
        print(f"\n[{i}/{len(plan)}] {model.repo_id}: {len(files)} files, {format_size(total)}")
        path = snapshot_download(model.repo_id, allow_patterns=files)
        print(f"    done -> {path}")

    minutes = (time.time() - start) / 60
    print(f"\nAll {len(plan)} models are in {hf_home} ({format_size(grand_total)}, {minutes:.1f} min).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
