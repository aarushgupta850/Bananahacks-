"""Tests for pipeline/strays.py: stray marks are erased, the subject and its inner details are kept, and a subject
running off the page is spotted. Synthetic drawings, no GPU."""

import cv2
import numpy as np
from PIL import Image

from pipeline.strays import INK_LEVEL, is_cut_off, remove_strays

PAGE, INK = 225, (20, 20, 20)
AA = cv2.LINE_AA


def page() -> np.ndarray:
    return np.full((768, 768, 3), PAGE, np.uint8)


def cat(c: np.ndarray, dy: int = 0) -> np.ndarray:
    """A simple cat: body, head, two eyes (dots inside the head) and a whisker just off the head."""
    cv2.ellipse(c, (400, 470 + dy), (170, 110), 0, 0, 360, INK, 10, AA)
    cv2.circle(c, (250, 300 + dy), 95, INK, 10, AA)
    cv2.circle(c, (225, 290 + dy), 9, INK, -1, AA)
    cv2.circle(c, (275, 290 + dy), 9, INK, -1, AA)
    cv2.line(c, (140, 330 + dy), (110, 335 + dy), INK, 4, AA)  # a whisker, separate but right by the head
    return c


def ink(image) -> np.ndarray:
    return np.asarray(Image.fromarray(image) if isinstance(image, np.ndarray) else image.convert("L")) < INK_LEVEL


def test_floating_dashes_and_sparkles_are_erased_and_the_subject_stays():
    c = cat(page())
    cv2.line(c, (650, 90), (700, 80), INK, 5, AA)            # a floating dash
    cv2.line(c, (60, 700), (90, 690), INK, 5, AA)            # another, bottom left
    for dx, dy in [(0, 12), (12, 0)]:                        # a little sparkle (a plus sign)
        cv2.line(c, (690 - dx, 650 - dy), (690 + dx, 650 + dy), INK, 4, AA)
    out = np.asarray(remove_strays(Image.fromarray(c)).convert("L"))
    assert (out[60:110, 640:710] < INK_LEVEL).sum() == 0     # dash gone
    assert (out[680:710, 50:100] < INK_LEVEL).sum() == 0     # dash gone
    assert (out[630:670, 670:710] < INK_LEVEL).sum() == 0    # sparkle gone
    clean = np.asarray(Image.fromarray(cat(page())).convert("L")) < INK_LEVEL
    assert ((out < INK_LEVEL) == clean).mean() > 0.999       # everything else is exactly the cat
    assert abs(int(out[740, 740]) - PAGE) <= 1 and abs(int(out[85, 675]) - PAGE) <= 2  # erased to the page's color


def test_a_drawing_without_strays_is_returned_unchanged():
    image = Image.fromarray(cat(page()))
    assert remove_strays(image) is image


def test_separate_big_parts_are_kept():
    # A bicycle-like drawing: two separate wheels of the same size, nothing joins them.
    c = page()
    cv2.circle(c, (230, 450), 120, INK, 8, AA)
    cv2.circle(c, (540, 450), 120, INK, 8, AA)
    image = Image.fromarray(c)
    assert remove_strays(image) is image


def test_a_subject_running_off_the_page_is_cut_off():
    assert not is_cut_off(Image.fromarray(cat(page())))
    assert is_cut_off(Image.fromarray(cat(page(), dy=260)))  # the body runs off the bottom edge


def test_a_drawing_made_of_separate_marks_is_left_alone():
    # Stars (or rain, or a dotted outline): every mark is far from the others, and together they are the drawing.
    c = page()
    for k in range(20):
        x, y = 80 + (k % 5) * 150, 80 + (k // 5) * 160
        cv2.line(c, (x, y), (x + 30, y + 10), INK, 6, AA)
    image = Image.fromarray(c)
    assert remove_strays(image) is image
