"""Loads the image AI models the same way for every script (smoke test, speed test, pack builder).

Everything is read from the local Hugging Face cache only (run scripts/download_models.py first),
so a missing file fails fast instead of starting a download in the middle of a run.
"""

from __future__ import annotations

import gc
import os

from scripts.download_models import (
    ENV_FILE,
    FLUX_GGUF_FILES,
    FLUX_GGUF_REPO,
    FLUX_REPO,
    image_model,  # noqa: F401 - generate.py reads it as models.image_model
    lightning_file,
    lightning_steps,
    lora_setting,
    read_env_file,
)

BASE_REPO = "stabilityai/stable-diffusion-xl-base-1.0"
LIGHTNING_REPO = "ByteDance/SDXL-Lightning"
LIGHTNING_FILE = "sdxl_lightning_4step_unet.safetensors"  # the default; lightning_steps() can pick the 8-step one
CONTROLNET_REPO = "TheMistoAI/MistoLine"  # SDXL ControlNet that follows line art (photo path only)
ANNOTATORS_REPO = "lllyasviel/Annotators"  # weights for controlnet_aux's LineartDetector
OWL_REPO = "google/owlv2-base-patch16-ensemble"  # finds parts (head, ear, ...) from text labels
FLUX_STEPS = 4  # FLUX.1-schnell is distilled for 1-4 steps, without guidance
LORA_SCALE = 0.8  # how strongly a style LoRA (GHOSTLINES_LORA) pulls SDXL toward its style (1 = fully)

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
    """SDXL with the SDXL-Lightning UNet (4-step, or 8-step with GHOSTLINES_LIGHTNING_STEPS=8). Generate with
    lightning_steps() steps and guidance 0.

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
    unet.load_state_dict(load_file(hf_hub_download(LIGHTNING_REPO, lightning_file(lightning_steps()))))
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
    lora = lora_setting()
    if lora:
        # Merged into the UNet's weights once, so drawing with it costs no extra time.
        pipe.load_lora_weights(lora[0], weight_name=lora[1])
        pipe.fuse_lora(lora_scale=LORA_SCALE)
        pipe.unload_lora_weights()  # the merged weights stay; only the separate LoRA copy goes
    _, vram_gb = gpu_info()
    if vram_gb <= OFFLOAD_VRAM_GB:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")
    return pipe


def flux_gguf_path() -> str:
    """The downloaded 4-bit FLUX.1-schnell transformer (the first of FLUX_GGUF_FILES in the cache)."""
    from huggingface_hub import hf_hub_download, try_to_load_from_cache

    for name in FLUX_GGUF_FILES:
        path = try_to_load_from_cache(FLUX_GGUF_REPO, name)
        if isinstance(path, str):
            return path
    return hf_hub_download(FLUX_GGUF_REPO, FLUX_GGUF_FILES[0])  # offline: fails with a clear "not in the cache"


def load_flux():
    """FLUX.1-schnell, made to fit an 8 GB card: the 12-billion-parameter transformer is a 4-bit GGUF file (about
    7 GB), the T5 text encoder is loaded in 4 bits (bitsandbytes), and every part waits on the CPU until it's needed.
    Generate with FLUX_STEPS steps and guidance 0. Used for typed subjects when GHOSTLINES_MODEL=flux."""
    import torch
    from diffusers import FluxPipeline, FluxTransformer2DModel, GGUFQuantizationConfig
    from transformers import BitsAndBytesConfig, T5EncoderModel

    transformer = FluxTransformer2DModel.from_single_file(
        flux_gguf_path(),
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        config=FLUX_REPO,
        subfolder="transformer",
        torch_dtype=torch.bfloat16,
    )
    text_encoder_2 = T5EncoderModel.from_pretrained(
        FLUX_REPO,
        subfolder="text_encoder_2",
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16
        ),
        torch_dtype=torch.bfloat16,
    )
    pipe = FluxPipeline.from_pretrained(
        FLUX_REPO, transformer=transformer, text_encoder_2=text_encoder_2, torch_dtype=torch.bfloat16
    )
    pipe.enable_model_cpu_offload()  # even a 4-bit FLUX doesn't fit an 8 GB card all at once
    return pipe


def is_flux(pipe) -> bool:
    return type(pipe).__name__.startswith("Flux")


def photo_pipeline_from(text_pipe):
    """The photo pipeline (SDXL-Lightning + the MistoLine ControlNet) built on the text pipeline's own weights:
    only the ControlNet (about 2.5 GB) is new, so both can stay loaded on a PC without RAM to spare.
    Call use_pipeline() on whichever of the two runs next."""
    import torch
    from diffusers import ControlNetModel, StableDiffusionXLControlNetPipeline

    controlnet = ControlNetModel.from_pretrained(CONTROLNET_REPO, dtype=torch.float16, variant="fp16")
    # from_pipe would cast everything to float32 unless told otherwise.
    return StableDiffusionXLControlNetPipeline.from_pipe(text_pipe, controlnet=controlnet, dtype=torch.float16)


def img2img_pipeline_from(text_pipe):
    """SDXL-Lightning img2img on the text pipeline's own weights: nothing new is loaded."""
    import torch
    from diffusers import StableDiffusionXLImg2ImgPipeline

    return StableDiffusionXLImg2ImgPipeline.from_pipe(text_pipe, dtype=torch.float16)  # keep float16


def use_pipeline(pipe) -> None:
    """Gets a pipeline ready to run. The text and photo pipelines share modules, and CPU offloading hangs its
    hooks on the modules themselves, so they are re-attached for whichever pipeline runs next (fast: no
    weights are loaded)."""
    _, vram_gb = gpu_info()
    if vram_gb <= OFFLOAD_VRAM_GB:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")


def free_gpu() -> None:
    """Releases GPU memory after the caller has dropped its references (e.g. `del pipe`)."""
    import torch

    gc.collect()
    torch.cuda.empty_cache()
