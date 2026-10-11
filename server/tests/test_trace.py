"""Tests for the stroke tracer, on synthetic drawings made with OpenCV. No GPU needed."""

import math

import cv2
import numpy as np
from PIL import Image

from pipeline.trace import trace

INK = (20, 20, 20)


def page() -> np.ndarray:
    # Light gray, like the generated drawings, rather than pure white.
    return np.full((768, 768, 3), 222, dtype=np.uint8)


def pil(canvas: np.ndarray) -> Image.Image:
    return Image.fromarray(canvas)


def length(stroke) -> float:
    return sum(math.dist(a, b) for a, b in zip(stroke, stroke[1:]))


def is_closed(stroke) -> bool:
    return math.dist(stroke[0], stroke[-1]) < 3


def test_circle_and_two_lines():
    canvas = page()
    cv2.circle(canvas, (384, 300), 150, INK, 6)
    cv2.line(canvas, (100, 650), (350, 650), INK, 6)
    cv2.line(canvas, (450, 600), (700, 700), INK, 6)
    strokes = trace(pil(canvas))

    assert len(strokes) == 3
    circle, *lines = strokes  # longest first
    assert is_closed(circle)
    assert abs(length(circle) - 2 * math.pi * 150) < 0.1 * 2 * math.pi * 150
    expected = sorted([250, math.dist((450, 600), (700, 700))], reverse=True)
    for line, want in zip(lines, expected):
        assert not is_closed(line)
        assert abs(length(line) - want) < 0.1 * want


def test_thick_icon_style_outline_is_one_stroke():
    canvas = page()
    cv2.circle(canvas, (384, 384), 200, INK, 16)  # bold, like the icon_clean prompt draws
    strokes = trace(pil(canvas))
    assert len(strokes) == 1
    assert is_closed(strokes[0])


def test_crossing_lines_stay_two_straight_strokes():
    canvas = page()
    cv2.line(canvas, (100, 100), (668, 668), INK, 6)
    cv2.line(canvas, (668, 100), (100, 668), INK, 6)
    strokes = trace(pil(canvas))
    assert len(strokes) == 2
    for stroke in strokes:
        assert abs(length(stroke) - math.dist((100, 100), (668, 668))) < 40


def test_t_junction_keeps_the_bar_whole():
    canvas = page()
    cv2.line(canvas, (100, 200), (668, 200), INK, 6)  # the bar
    cv2.line(canvas, (384, 200), (384, 600), INK, 6)  # the stem
    strokes = trace(pil(canvas))
    assert len(strokes) == 2
    bar, stem = strokes
    assert abs(length(bar) - 568) < 30
    assert abs(length(stem) - 400) < 30


def test_a_corner_is_one_stroke():
    canvas = page()
    cv2.polylines(canvas, [np.array([(150, 150), (150, 600), (600, 600)])], False, INK, 8)
    strokes = trace(pil(canvas))
    assert len(strokes) == 1
    assert abs(length(strokes[0]) - 900) < 40


def test_points_are_x_y_in_768_space_and_simplified():
    canvas = page()
    cv2.line(canvas, (100, 650), (350, 650), INK, 6)
    (stroke,) = trace(pil(canvas))
    xs, ys = [p[0] for p in stroke], [p[1] for p in stroke]
    assert min(xs) < 110 and max(xs) > 340  # x runs along the line
    assert all(abs(y - 650) < 3 for y in ys)  # y stays on it
    assert len(stroke) <= 3  # a straight line simplifies to its ends


def test_a_smaller_image_is_scaled_to_768_space():
    canvas = np.full((384, 384, 3), 222, dtype=np.uint8)
    cv2.line(canvas, (50, 325), (175, 325), INK, 4)
    (stroke,) = trace(pil(canvas))
    assert all(abs(y - 650) < 4 for _, y in stroke)


def test_specks_and_blank_pages_give_no_strokes():
    canvas = page()
    for x in range(50, 700, 60):
        cv2.circle(canvas, (x, 100), 2, INK, -1)  # tiny dots, under 30 px each
    assert trace(pil(canvas)) == []
    assert trace(pil(page())) == []


def test_a_solid_dot_becomes_a_small_circle_stroke():
    canvas = page()
    cv2.circle(canvas, (300, 300), 150, INK, 8)
    cv2.circle(canvas, (260, 280), 10, INK, -1)  # an eye: a filled dot inside the head
    strokes = trace(pil(canvas))
    assert len(strokes) == 2
    head, eye = strokes
    assert is_closed(eye)
    xs, ys = [p[0] for p in eye], [p[1] for p in eye]
    assert abs(sum(xs) / len(xs) - 260) < 3 and abs(sum(ys) / len(ys) - 280) < 3
    assert length(eye) < 2 * math.pi * 10  # smaller than the dot itself
