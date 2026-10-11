"""Tests for the line-art prompts. No GPU needed."""

import pytest

from pipeline.prompts import CHOSEN, DIFFICULTY_HINTS, VARIANTS, line_art_prompt


def test_prompt_contains_subject_and_line_art_wording():
    prompt = line_art_prompt("a fox")
    assert "a fox" in prompt
    assert "white" in prompt


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_every_variant_names_the_subject_once_and_asks_for_white(variant):
    template = VARIANTS[variant]
    assert template.count("{subject}") == 1
    assert "white" in template
    # SDXL reads at most 77 tokens; 45 words keeps us safely under that.
    assert len(line_art_prompt("a coffee mug", variant).split()) <= 45


def test_chosen_variant_exists():
    assert CHOSEN in VARIANTS


def test_prompt_collapses_extra_whitespace():
    assert "a coffee mug," in line_art_prompt("  a   coffee\nmug ", "baseline")


def test_prompt_rejects_empty_subject_and_unknown_variant():
    with pytest.raises(ValueError):
        line_art_prompt("   ")
    with pytest.raises(ValueError):
        line_art_prompt("a fox", "nope")


def test_difficulty_adds_its_hint_after_the_subject():
    assert "a fox, very simple, few lines" in line_art_prompt("a fox", difficulty="simple")
    assert "a fox, more detail" in line_art_prompt("a fox", difficulty="detailed")
    assert line_art_prompt("a fox", difficulty="medium") == line_art_prompt("a fox")


@pytest.mark.parametrize("difficulty", sorted(DIFFICULTY_HINTS))
def test_chosen_prompt_stays_short_at_every_difficulty(difficulty):
    # SDXL reads at most 77 tokens; 50 words keeps us under that even with a difficulty hint.
    assert len(line_art_prompt("a coffee mug", difficulty=difficulty).split()) <= 50


def test_unknown_difficulty_is_rejected():
    with pytest.raises(ValueError):
        line_art_prompt("a fox", difficulty="hard")
