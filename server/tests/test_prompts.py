"""Tests for the line-art prompt. No GPU needed."""

import pytest

from pipeline.prompts import line_art_prompt


def test_prompt_contains_subject_and_line_art_wording():
    prompt = line_art_prompt("a fox")
    assert "a fox" in prompt
    assert "line drawing" in prompt
    assert "white background" in prompt


def test_prompt_collapses_extra_whitespace():
    assert "a coffee mug," in line_art_prompt("  a   coffee\nmug ")


def test_prompt_rejects_empty_subject():
    with pytest.raises(ValueError):
        line_art_prompt("   ")
