"""Tests for the line cleanliness score, on synthetic drawings. No GPU needed."""

import random

from PIL import Image, ImageDraw

from pipeline.quality import line_metrics


def blank() -> Image.Image:
    return Image.new("RGB", (768, 768), "white")


def clean_circle() -> Image.Image:
    image = blank()
    ImageDraw.Draw(image).ellipse((184, 184, 584, 584), outline="black", width=6)
    return image


def test_clean_outline_is_one_piece_without_specks():
    m = line_metrics(clean_circle())
    assert m["specks"] == 0
    assert m["pieces"] == 1
    assert 0.005 < m["ink"] < 0.15


def test_specks_are_counted_and_make_the_score_worse():
    noisy = clean_circle()
    draw = ImageDraw.Draw(noisy)
    rng = random.Random(0)
    for _ in range(40):  # 40 separate 3 x 3 dots, far smaller than a line
        x, y = rng.randrange(20, 160), rng.randrange(20, 748)
        draw.rectangle((x, y, x + 2, y + 2), fill="black")
    assert line_metrics(noisy)["specks"] >= 35
    assert line_metrics(noisy)["score"] > line_metrics(clean_circle())["score"]


def test_gray_shading_raises_the_gray_ratio():
    shaded = clean_circle()
    ImageDraw.Draw(shaded).ellipse((260, 260, 508, 508), fill=(150, 150, 150))  # soft gray fill
    assert line_metrics(shaded)["gray_ratio"] > line_metrics(clean_circle())["gray_ratio"] + 1
    assert line_metrics(shaded)["score"] > line_metrics(clean_circle())["score"]


def test_solid_black_fill_is_penalized():
    filled = blank()
    ImageDraw.Draw(filled).rectangle((100, 100, 668, 668), fill="black")
    assert line_metrics(filled)["score"] > line_metrics(clean_circle())["score"] + 100


def test_blank_page_never_wins():
    assert line_metrics(blank())["score"] >= 1000
