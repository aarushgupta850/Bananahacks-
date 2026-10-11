"""Loads the image AI models the same way for every script (smoke test, speed test, pack builder).

Everything is read from the local Hugging Face cache only (run scripts/download_models.py first),
so a missing file fails fast instead of starting a download in the middle of a run.
"""

from __future__ import annotations

import gc
import os

from scripts.download_models import ENV_FILE, read_env_file

BASE_REPO = "stabilityai/stable-diffusion-xl-base-1.0"
LIGHTNING_REPO = "ByteDance/SDXL-Lightning"
LIGHTNING_FILE = "sdxl_lightning_4step_unet.safetensors"
CONTROLNET_REPO = "TheMistoAI/MistoLine"  # SDXL ControlNet that follows line art (photo path only)
ANNOTATORS_REPO = "lllyasviel/Annotators"  # weights for controlnet_aux's LineartDetector
OWL_REPO = "google/owlv2-base-patch16-ensemble"  # finds parts (head, ear, ...) from text labels

# Cards with this much VRAM or less can't hold SDXL at once, so parts wait on the CPU until needed.
# 8.5 rather than 8 because an "8 GB" card reports slightly under 8.0.
OFFLOAD_VRAM_GB = 8.5


def setup_hf_env() -> str | None:
    """Points the Hugging Face libraries at HF_HOME from .env and turns on offline mode.

    Must run before diffusers, transformers or huggingface_hub are imported, because they read
    these settings at import time. A value already set in the shell wins over the .env file.
    """
    env = read_env_file(ENV_FILE)
    if env.get("HF_HOME") and not os.environ.get("HF_HOME"):
        os.environ["HF_HOME"] = env["HF_HOME"]
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    return os.environ.get("HF_HOME")


def gpu_info() -> tuple[str, float]:
    """Returns (GPU name, VRAM in GB). Raises if CUDA isn't available."""
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available. Check the torch install (it must be a +cu build).")
    props = torch.cuda.get_device_properties(0)
    return props.name, props.total_memory / 1024**3


def load_lightning(with_controlnet: bool = False):
    """SDXL with the SDXL-Lightning 4-step UNet. Use 4 steps and guidance 0 when generating.

    with_controlnet=True adds the MistoLine ControlNet, for the photo path: the pipeline then
    takes a line-art image (white lines on black) and draws a clean version of it.
    """
    import torch
    from diffusers import (
        ControlNetModel,
        EulerDiscreteScheduler,
        StableDiffusionXLControlNetPipeline,
        StableDiffusionXLPipeline,
        UNet2DConditionModel,
    )
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file

    # Build an empty SDXL UNet from the base config, then fill it with the Lightning weights.
    unet = UNet2DConditionModel.from_config(UNet2DConditionModel.load_config(BASE_REPO, subfolder="unet"))
    unet.load_state_dict(load_file(hf_hub_download(LIGHTNING_REPO, LIGHTNING_FILE)))
    unet = unet.to(torch.float16)

    if with_controlnet:
        controlnet = ControlNetModel.from_pretrained(CONTROLNET_REPO, dtype=torch.float16, variant="fp16")
        pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
            BASE_REPO, unet=unet, controlnet=controlnet, dtype=torch.float16, variant="fp16"
        )
    else:
        pipe = StableDiffusionXLPipeline.from_pretrained(
            BASE_REPO, unet=unet, dtype=torch.float16, variant="fp16"
        )

    # Lightning was distilled with "trailing" timesteps; other spacings give blurry results.
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    _, vram_gb = gpu_info()
    if vram_gb <= OFFLOAD_VRAM_GB:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")
    return pipe


def free_gpu() -> None:
    """Releases GPU memory after the caller has dropped its references (e.g. `del pipe`)."""
    import torch

    gc.collect()
    torch.cuda.empty_cache()
