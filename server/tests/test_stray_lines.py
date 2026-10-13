"""Tests for pipeline/stray_lines.py on synthetic drawings: long stray arcs joined to the subject are found and
erased; lines that belong to the subject stay."""

import cv2
import numpy as np
from PIL import Image

from build_pack import without_strokes
from pipeline.stray_lines import find_strays, split_off, stray_share
from pipeline.trace import trace

INK = (25, 25, 25)


def page() -> np.ndarray:
    return np.full((768, 768, 3), 235, np.uint8)


def car(c: np.ndarray) -> None:
    """A closed car body with two wheels, on the lower half of the page."""
    cv2.rectangle(c, (120, 420), (640, 560), INK, 8, cv2.LINE_AA)
    cv2.rectangle(c, (240, 340), (520, 420), INK, 8, cv2.LINE_AA)
    for x in (230, 530):
        cv2.circle(c, (x, 570), 50, INK, 8, cv2.LINE_AA)


def strays_of(c: np.ndarray):
    image = Image.fromarray(c)
    strokes = trace(image)
    return image, strokes, find_strays(image, strokes)


def test_a_big_arc_swooping_over_the_subject_is_found_and_erased():
    c = page()
    car(c)
    cv2.ellipse(c, (430, 420), (300, 300), 0, 200, 358, INK, 6, cv2.LINE_AA)  # touches the car at its right end
    image, strokes, strays = strays_of(c)
    assert strays and stray_share(strokes, strays) > 0.15
    kept, dropped = split_off(strokes, strays)
    cleaned = without_strokes(image, kept, dropped)
    top = np.asarray(cleaned.convert("L"))[:300]  # the arc's top, far above the car
    assert (top < 128).sum() < 50
    assert find_strays(cleaned, trace(cleaned)) == []


def test_a_clean_subject_has_no_strays():
    c = page()
    car(c)
    assert strays_of(c)[2] == []


def test_lines_inside_or_joining_the_subject_stay():
    c = page()
    car(c)
    cv2.ellipse(c, (380, 480), (200, 160), 0, 200, 340, INK, 6, cv2.LINE_AA)  # a curve inside the body
    # A flower: a head and a pot joined by a long stem (both its ends are on the subject)
    cv2.circle(c, (680, 120), 40, INK, 8, cv2.LINE_AA)
    cv2.rectangle(c, (650, 330), (710, 400), INK, 8, cv2.LINE_AA)
    cv2.line(c, (680, 160), (680, 330), INK, 6, cv2.LINE_AA)
    assert strays_of(c)[2] == []


def test_a_wavy_tail_with_a_loose_end_stays():
    c = page()
    car(c)  # a stand-in body
    xs = np.arange(640, 760, 4)
    tail = np.stack([xs, 420 - 60 * np.sin((xs - 640) / 18.0) - (xs - 640)], axis=1).astype(np.int32)
    cv2.polylines(c, [tail], False, INK, 6, cv2.LINE_AA)
    assert strays_of(c)[2] == []


def test_a_bust_running_off_the_bottom_edge_keeps_its_shoulders():
    c = page()
    cv2.circle(c, (384, 250), 120, INK, 8, cv2.LINE_AA)  # the head
    cv2.ellipse(c, (384, 768), (330, 300), 0, 180, 360, INK, 8, cv2.LINE_AA)  # shoulders, cut off by the page
    assert strays_of(c)[2] == []
