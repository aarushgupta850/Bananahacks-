"""Shared test setup: tests never call OpenAI or Gemini, whatever the .env file on this PC says."""

import pytest


@pytest.fixture(autouse=True)
def draw_with_sdxl(monkeypatch):
    """GHOSTLINES_IMAGE_MODEL from the shell wins over .env, so this keeps every test on the SDXL path.
    Tests of the OpenAI path set it to "openai" themselves."""
    monkeypatch.setenv("GHOSTLINES_IMAGE_MODEL", "sdxl")
    monkeypatch.setenv("GHOSTLINES_GEMINI", "0")  # tests of pipeline/gemini.py turn it back on
