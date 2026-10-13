"""Tests for pipeline/frame.py: a frame drawn around the picture is erased, the subject is kept."""

import numpy as np
from PIL import Image, ImageDraw

from pipeline.frame import remove_frame

INK = (20, 20, 20)


def page() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (768, 768), (250, 250, 250))
    return image, ImageDraw.Draw(image)


def ink(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("L")) < 128


def test_a_double_frame_is_erased_and_the_subject_kept():
    image, draw = page()
    for inset in (12, 26):  # two rectangles hugging the edges, like the basketball's card
        draw.rectangle([inset, inset, 767 - inset, 767 - inset], outline=INK, width=4)
    draw.ellipse([224, 224, 544, 544], outline=INK, width=8)  # the subject
    out = ink(remove_frame(image))
    assert not out[:60].any() and not out[-60:].any() and not out[:, :60].any() and not out[:, -60:].any()
    assert out[224:545, 224:545].sum() == ink(image)[224:545, 224:545].sum()  # the circle is untouched


def test_a_slightly_wavy_hand_drawn_frame_is_erased():
    image, draw = page()
    xs = np.arange(30, 739)
    for y0 in (30, 738):  # top and bottom lines that wander by 2 px
        draw.line(list(zip(xs, y0 + np.round(2 * np.sin(xs / 40)).astype(int))), fill=INK, width=3)
    for x0 in (30, 738):
        draw.line(list(zip(x0 + np.round(2 * np.sin(xs / 50)).astype(int), xs)), fill=INK, width=3)
    draw.ellipse([300, 300, 470, 470], outline=INK, width=6)
    out = ink(remove_frame(image))
    assert not out[:50].any() and not out[:, :50].any()
    assert out[300:471, 300:471].any()


def test_a_ground_line_alone_is_not_a_frame():
    image, draw = page()
    draw.rectangle([250, 300, 520, 600], outline=INK, width=6)  # a house
    draw.line([(40, 700), (728, 700)], fill=INK, width=5)       # the ground under it, near the bottom edge
    assert np.array_equal(np.asarray(remove_frame(image)), np.asarray(image))


def test_a_drawing_without_a_frame_is_unchanged():
    image, draw = page()
    draw.ellipse([150, 150, 618, 618], outline=INK, width=8)
    assert np.array_equal(np.asarray(remove_frame(image)), np.asarray(image))


def test_lines_along_two_opposite_edges_are_a_frame():
    # A close-up framed by a line along the top and one along the bottom (the cat's head that filled the page).
    image, draw = page()
    draw.line([(30, 25), (740, 25)], fill=INK, width=5)
    draw.line([(30, 742), (740, 742)], fill=INK, width=5)
    draw.ellipse((250, 250, 520, 520), outline=INK, width=8)
    out = ink(remove_frame(image))
    assert not out[:45].any() and not out[-45:].any()
    assert out[250:521, 250:521].any()
