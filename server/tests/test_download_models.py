"""Tests for the download script's helpers. No network, no GPU, no huggingface_hub needed."""

from scripts.download_models import MODELS, pick_files, read_env_file


def test_read_env_file_skips_comments_and_strips_quotes(tmp_path):
    env = tmp_path / ".env"
    env.write_text('# cache\nHF_HOME="C:\\hf-cache"\n\nALLOWED_ORIGIN=\n', encoding="utf-8")
    assert read_env_file(env) == {"HF_HOME": "C:\\hf-cache", "ALLOWED_ORIGIN": ""}


def test_read_env_file_missing_file_is_empty(tmp_path):
    assert read_env_file(tmp_path / "nope.env") == {}


def test_pick_files_folder_patterns_and_alternatives():
    repo = [
        "tokenizer/vocab.json",
        "tokenizer/merges.txt",
        "tokenizer_2/vocab.json",
        "unet/diffusion_pytorch_model.safetensors",
        "unet/diffusion_pytorch_model.fp16.safetensors",
    ]
    files, missing = pick_files(
        [
            "tokenizer/*",
            # fp16 is preferred, so the full-precision file must not be picked as well.
            ("unet/diffusion_pytorch_model.fp16.safetensors", "unet/diffusion_pytorch_model.safetensors"),
        ],
        repo,
    )
    assert missing == []
    assert files == [
        "tokenizer/vocab.json",
        "tokenizer/merges.txt",
        "unet/diffusion_pytorch_model.fp16.safetensors",
    ]


def test_pick_files_reports_missing_patterns():
    files, missing = pick_files(["sk_model.pth", ("a.bin", "b.bin")], ["sk_model.pth"])
    assert files == ["sk_model.pth"]
    assert missing == ["a.bin or b.bin"]


def test_lightning_downloads_only_the_4_step_unet():
    lightning = next(m for m in MODELS if m.repo_id == "ByteDance/SDXL-Lightning")
    repo = [
        "sdxl_lightning_2step_unet.safetensors",
        "sdxl_lightning_4step_unet.safetensors",
        "sdxl_lightning_4step_lora.safetensors",
        "sdxl_lightning_4step.safetensors",
    ]
    assert pick_files(lightning.patterns, repo) == (["sdxl_lightning_4step_unet.safetensors"], [])


def test_flux_and_a_lora_are_only_downloaded_when_switched_on(monkeypatch):
    from scripts.download_models import FLUX_GGUF_REPO, FLUX_REPO, image_model, lora_setting, models_to_fetch

    for name in ("GHOSTLINES_MODEL", "GHOSTLINES_LORA", "GHOSTLINES_LIGHTNING_STEPS"):
        monkeypatch.delenv(name, raising=False)
    repos = lambda env: [m.repo_id for m in models_to_fetch(env)]  # noqa: E731
    assert image_model({}) == "sdxl" and lora_setting({}) is None
    assert FLUX_REPO not in repos({}) and FLUX_GGUF_REPO not in repos({})
    assert {FLUX_REPO, FLUX_GGUF_REPO} <= set(repos({"GHOSTLINES_MODEL": "flux"}))
    with_lora = models_to_fetch({"GHOSTLINES_LORA": "someone/coloring-lora:coloring.safetensors"})
    assert with_lora[-1].repo_id == "someone/coloring-lora" and with_lora[-1].patterns == ["coloring.safetensors"]


def test_bad_model_and_lora_settings_are_refused(monkeypatch):
    import pytest

    from scripts.download_models import image_model, lora_setting

    monkeypatch.delenv("GHOSTLINES_MODEL", raising=False)
    monkeypatch.delenv("GHOSTLINES_LORA", raising=False)
    with pytest.raises(ValueError):
        image_model({"GHOSTLINES_MODEL": "dalle"})
    with pytest.raises(ValueError):
        lora_setting({"GHOSTLINES_LORA": "no-file-name"})
    monkeypatch.setenv("GHOSTLINES_MODEL", "flux")  # the shell wins over .env
    assert image_model({"GHOSTLINES_MODEL": "sdxl"}) == "flux"
