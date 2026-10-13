"""The "better drawings" switches: the 8-step Lightning UNet, the icon_even prompt and the symmetry tie-break.
Each is off by default, so nothing changes until it's switched on. No GPU: only the choices are tested."""

import pytest
from PIL import Image, ImageDraw

import api
from build_pack import Candidate, choose
from pipeline.prompts import CHOSEN, VARIANTS, active_variant, line_art_prompt
from pipeline.quality import symmetry
from scripts.download_models import LIGHTNING_8STEP, MODELS, lightning_file, lightning_steps, models_to_fetch, pick_files

SWITCHES = ("GHOSTLINES_LIGHTNING_STEPS", "GHOSTLINES_PROMPT", "GHOSTLINES_PREFER_SYMMETRY", "GHOSTLINES_LIVE_CANDIDATES")


@pytest.fixture(autouse=True)
def switches_off(monkeypatch):
    for name in SWITCHES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("scripts.download_models.read_env_file", lambda path: {})  # ignore a real .env


# ---------------------------------------------------------------- 8-step UNet

def test_lightning_is_4_step_unless_switched_to_8(monkeypatch):
    assert lightning_steps({}) == 4
    assert lightning_steps({"GHOSTLINES_LIGHTNING_STEPS": "8"}) == 8  # from .env
    monkeypatch.setenv("GHOSTLINES_LIGHTNING_STEPS", "8")
    assert lightning_steps({"GHOSTLINES_LIGHTNING_STEPS": "4"}) == 8  # the shell wins over .env


def test_other_step_counts_are_refused(monkeypatch):
    monkeypatch.setenv("GHOSTLINES_LIGHTNING_STEPS", "6")
    with pytest.raises(ValueError, match="4 or 8"):
        lightning_steps({})


def test_the_8_step_unet_is_downloaded_only_when_switched_on():
    assert models_to_fetch({}) == MODELS
    assert models_to_fetch({"GHOSTLINES_LIGHTNING_STEPS": "8"}) == MODELS + [LIGHTNING_8STEP]
    repo = [lightning_file(2), lightning_file(4), lightning_file(8), "sdxl_lightning_8step_lora.safetensors"]
    assert pick_files(LIGHTNING_8STEP.patterns, repo) == (["sdxl_lightning_8step_unet.safetensors"], [])


def test_live_lessons_make_fewer_drafts_with_the_slower_8_step_model(monkeypatch):
    assert api.live_candidates() == api.LIVE_CANDIDATES == 3
    monkeypatch.setenv("GHOSTLINES_LIGHTNING_STEPS", "8")
    assert api.live_candidates() == 2
    monkeypatch.setenv("GHOSTLINES_LIVE_CANDIDATES", "3")
    assert api.live_candidates() == 3


# ---------------------------------------------------------------- icon_even prompt

def test_the_prompt_is_the_chosen_one_unless_switched(monkeypatch):
    assert active_variant() == CHOSEN
    monkeypatch.setenv("GHOSTLINES_PROMPT", "icon_even")
    assert active_variant() == "icon_even"
    assert "symmetrical" in line_art_prompt("a basketball", variant=active_variant())
    monkeypatch.setenv("GHOSTLINES_PROMPT", "no_such_prompt")
    with pytest.raises(ValueError, match="not a prompt variant"):
        active_variant()


@pytest.mark.parametrize("difficulty", ["simple", "medium", "detailed"])
def test_icon_even_is_no_longer_than_the_chosen_prompt(difficulty):
    # SDXL reads at most 77 tokens; the chosen prompt is known to fit, so icon_even must not be longer.
    even = line_art_prompt("a coffee mug", variant="icon_even", difficulty=difficulty).split()
    chosen = line_art_prompt("a coffee mug", variant=CHOSEN, difficulty=difficulty).split()
    assert "icon_even" in VARIANTS and len(even) <= len(chosen) <= 50


# ---------------------------------------------------------------- symmetry

def drawing(shapes) -> Image.Image:
    image = Image.new("RGB", (768, 768), "white")
    draw = ImageDraw.Draw(image)
    for kind, box in shapes:
        if kind == "ellipse":
            draw.ellipse(box, outline="black", width=8)  # an outline: fill= would paint a solid disc
        else:
            draw.line(box, fill="black", width=8)
    return image


def test_a_ball_with_matching_seams_is_more_symmetric_than_a_lopsided_one():
    ball = [("ellipse", (184, 184, 584, 584)), ("line", (384, 184, 384, 584))]
    even = drawing(ball + [("line", (250, 210, 300, 560)), ("line", (518, 210, 468, 560))])
    lopsided = drawing(ball + [("line", (250, 210, 330, 560)), ("line", (420, 260, 560, 300))])
    assert symmetry(even) > 0.9
    assert symmetry(lopsided) < symmetry(even) - 0.1
    assert symmetry(Image.new("RGB", (768, 768), "white")) == 0.0  # a blank page


def test_symmetry_only_breaks_ties_when_switched_on(monkeypatch):
    lines = [[(0, 0), (1, 1)]] * 20
    lopsided = Candidate(None, lines, 30.0, symmetry=0.5)
    even = Candidate(None, lines, 34.0, symmetry=0.95)  # a little less clean, much more symmetric
    messy_even = Candidate(None, lines, 80.0, symmetry=1.0)  # symmetric but far messier: never wins
    assert choose([lopsided, even, messy_even]) == 0  # off: the cleanest, as before
    monkeypatch.setenv("GHOSTLINES_PREFER_SYMMETRY", "1")
    assert choose([lopsided, even, messy_even]) == 1
