"""Tests for the line cleanliness score, on synthetic drawings. No GPU needed."""

import random

import numpy as np

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


def test_colored_drawing_is_rejected():
    colored = clean_circle()
    ImageDraw.Draw(colored).ellipse((260, 260, 508, 508), fill=(230, 120, 30))  # orange fur
    m = line_metrics(colored)
    assert m["color"] > 0.15
    assert m["score"] >= 1000
    assert line_metrics(clean_circle())["color"] < 0.05


def test_tinted_near_black_lines_are_not_color():
    image = blank()
    ImageDraw.Draw(image).ellipse((184, 184, 584, 584), outline=(30, 22, 16), width=6)  # warm black
    assert line_metrics(image)["color"] < 0.15


def test_a_mostly_black_page_is_rejected_like_a_colored_one():
    solid = blank()
    ImageDraw.Draw(solid).rectangle((0, 0, 767, 500), fill="black")  # 65% of the page black
    assert line_metrics(solid)["score"] >= 1000
    assert line_metrics(clean_circle())["score"] < 1000


def test_separate_subjects_counts_two_things_drawn_but_not_details_inside_one():
    from pipeline.quality import separate_subjects

    assert separate_subjects(clean_circle()) == 1
    two = blank()
    draw = ImageDraw.Draw(two)
    draw.rectangle((100, 100, 660, 330), outline="black", width=8)   # a car on top...
    draw.rectangle((100, 440, 660, 670), outline="black", width=8)   # ...and another below it
    assert separate_subjects(two) == 2
    house = blank()
    draw = ImageDraw.Draw(house)
    draw.rectangle((150, 150, 620, 620), outline="black", width=8)   # a house...
    draw.rectangle((220, 220, 400, 400), outline="black", width=6)   # ...with a big window inside, not touching
    draw.line([(160, 700), (190, 700)], fill="black", width=6)       # and a small mark below: too small to count
    assert separate_subjects(house) == 1
    assert separate_subjects(blank()) == 0


def test_biggest_subject_keeps_one_of_two_things_drawn_centered_and_nothing_else():
    from pipeline.quality import biggest_subject, separate_subjects

    assert biggest_subject(clean_circle()) is None                     # one subject: nothing to do
    two = blank()
    draw = ImageDraw.Draw(two)
    draw.rectangle((60, 60, 700, 330), outline="black", width=8)       # a big car on top...
    draw.rectangle((200, 470, 560, 680), outline="black", width=8)     # ...and a smaller one below it
    alone = biggest_subject(two)
    assert alone is not None and separate_subjects(alone) == 1
    ink = np.asarray(alone.convert("L")) < 128
    rows = np.nonzero(ink.any(axis=1))[0]
    assert abs((rows[0] + rows[-1]) / 2 - 384) <= 4                    # the big one, moved to the middle
    assert np.ptp(rows) < 300                                           # and only the big one
