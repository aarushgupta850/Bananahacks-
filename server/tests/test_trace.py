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


def test_medium_gray_fills_are_not_ink():
    canvas = page()
    cv2.circle(canvas, (384, 384), 200, INK, 8)
    cv2.circle(canvas, (384, 384), 120, (140, 140, 140), -1)  # a gray fill, like the inside of an ear
    strokes = trace(pil(canvas))
    assert len(strokes) == 1
    assert is_closed(strokes[0])


def test_a_solid_black_area_traces_as_its_outline_not_a_zigzag():
    canvas = page()
    cv2.rectangle(canvas, (250, 250), (500, 450), INK, -1)  # a filled window
    strokes = trace(pil(canvas))
    assert len(strokes) == 1
    (outline,) = strokes
    assert is_closed(outline)
    assert abs(length(outline) - 2 * (250 + 200)) < 0.1 * 2 * (250 + 200)


def test_tiny_bits_are_dropped_but_long_lines_stay():
    canvas = page()
    cv2.line(canvas, (100, 400), (600, 400), INK, 6)
    for x in range(120, 600, 60):
        cv2.line(canvas, (x, 500), (x + 12, 506), INK, 5)  # short dashes, like toe marks
    strokes = trace(pil(canvas))
    assert len(strokes) == 1


def test_a_gray_eye_without_an_outline_becomes_a_stroke():
    canvas = page()
    cv2.circle(canvas, (384, 384), 200, INK, 8)
    cv2.ellipse(canvas, (320, 330), (22, 12), 0, 0, 360, (140, 140, 140), -1)  # a gray almond eye
    strokes = trace(pil(canvas))
    assert len(strokes) == 2
    eye = strokes[1]
    assert is_closed(eye)
    xs, ys = [p[0] for p in eye], [p[1] for p in eye]
    assert abs(sum(xs) / len(xs) - 320) < 4 and abs(sum(ys) / len(ys) - 330) < 4
    assert max(xs) - min(xs) > max(ys) - min(ys)  # wider than tall, like the almond


def test_a_gray_fill_that_already_has_an_outline_is_not_traced_twice():
    canvas = page()
    cv2.circle(canvas, (384, 384), 60, (140, 140, 140), -1)  # gray fill
    cv2.circle(canvas, (384, 384), 60, INK, 6)  # with a dark outline on its edge
    strokes = trace(pil(canvas))
    assert len(strokes) == 1


def test_a_gray_eye_next_to_a_line_still_becomes_a_stroke():
    canvas = page()
    cv2.circle(canvas, (384, 384), 200, INK, 8)
    cv2.ellipse(canvas, (320, 330), (22, 12), 0, 0, 360, (140, 140, 140), -1)  # a gray almond eye
    cv2.line(canvas, (250, 352), (390, 352), INK, 6)  # a cheek line passing just under it
    strokes = trace(pil(canvas))
    assert any(is_closed(s) and abs(sum(p[0] for p in s) / len(s) - 320) < 5 for s in strokes[1:])


def test_tracing_a_noisy_page_is_fast():
    import time

    rng = np.random.default_rng(0)
    canvas = page()
    cv2.circle(canvas, (384, 384), 200, INK, 8, cv2.LINE_AA)
    noise = rng.integers(0, 2, size=(768, 768)) * rng.integers(100, 170, size=(768, 768))
    canvas[noise > 0] = noise[noise > 0, None]  # thousands of tiny gray specks, like anti-aliasing
    start = time.perf_counter()
    trace(pil(canvas))
    assert time.perf_counter() - start < 3.0
