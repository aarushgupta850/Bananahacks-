"""Shared test setup: tests never call OpenAI, whatever the .env file on this PC says."""

import pytest


@pytest.fixture(autouse=True)
def draw_with_sdxl(monkeypatch):
    """GHOSTLINES_IMAGE_MODEL from the shell wins over .env, so this keeps every test on the SDXL path.
    Tests of the OpenAI path set it to "openai" themselves."""
    monkeypatch.setenv("GHOSTLINES_IMAGE_MODEL", "sdxl")
