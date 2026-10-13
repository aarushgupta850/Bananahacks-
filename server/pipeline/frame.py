"""Removes a frame (a border drawn around the whole picture) from a generated drawing. No GPU needed.

SDXL often draws line art as if on a card: one or two rectangles hugging the edges of the image, around the
subject (a basketball came back inside a double frame). A frame is not part of the subject, would become
strokes the user has to copy, and squeezes the subject into the middle. It is found as long, nearly straight
lines close to the edges, on at least three sides or on two opposite ones (a single line along one edge may be
the ground under a house, so that alone is kept), and everything from the edge to the innermost frame line is
erased.

fit_to_page then frames the subject itself: a drawing that fills only part of the page (a car a third as wide as
the page) is cropped around its ink and scaled up, so every lesson's subject fills the page the same way.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

INK_LEVEL = 128     # gray value below this counts as ink (as in quality.py)
EDGE_BAND = 0.12    # a frame line lies within this share of the image size from an edge
LINE_SHARE = 0.6    # ...and runs along at least this share of that edge
WOBBLE_PX = 3       # hand-drawn frame lines wander a little: ink this close to a row (or column) counts on it
CLEAR_PX = 4        # also erase this many pixels inside the innermost frame line (its far edge, anti-aliasing)
MIN_SIDES = 3       # a frame has lines along at least this many of the four edges (or along two opposite ones)
FIT_MARGIN = 0.07   # fit_to_page: the space left around the subject, as a share of the page
FIT_MAX_SCALE = 1.8  # ...and it is scaled up at most this much (more would blur its lines)
CENTER_SLACK = 0.05  # a subject whose middle is at most this share of the page off center is left where it is


def _innermost(coverage: np.ndarray, band: int, from_end: bool) -> int | None:
    """Index of the frame line closest to the middle within `band` rows of one edge, or None."""
    indices = range(len(coverage) - 1, len(coverage) - 1 - band, -1) if from_end else range(band)
    hits = [i for i in indices if coverage[i] >= LINE_SHARE]
    if not hits:
        return None
    return min(hits) if from_end else max(hits)


def remove_frame(image: Image.Image) -> Image.Image:
    """The image with its frame (if any) erased to white. Returns the image unchanged when there is no frame."""
    rgb = image.convert("RGB")
    ink = np.asarray(rgb.convert("L")) < INK_LEVEL
    h, w = ink.shape
    # Thicken lines across their direction so a slightly wavy frame line still fills one row (or column).
    rows = ndimage.binary_dilation(ink, structure=np.ones((2 * WOBBLE_PX + 1, 1), bool)).mean(axis=1)
    cols = ndimage.binary_dilation(ink, structure=np.ones((1, 2 * WOBBLE_PX + 1), bool)).mean(axis=0)
    band_h, band_w = max(1, int(EDGE_BAND * h)), max(1, int(EDGE_BAND * w))
    top = _innermost(rows, band_h, from_end=False)
    bottom = _innermost(rows, band_h, from_end=True)
    left = _innermost(cols, band_w, from_end=False)
    right = _innermost(cols, band_w, from_end=True)
    sides = [s for s in (top, bottom, left, right) if s is not None]
    opposite = (top is not None and bottom is not None) or (left is not None and right is not None)
    if len(sides) < MIN_SIDES and not opposite:
        return image
    out = np.asarray(rgb).copy()
    reach = WOBBLE_PX + CLEAR_PX
    if top is not None:
        out[: top + reach + 1] = 255
    if bottom is not None:
        out[max(0, bottom - reach):] = 255
    if left is not None:
        out[:, : left + reach + 1] = 255
    if right is not None:
        out[:, max(0, right - reach):] = 255
    return Image.fromarray(out, "RGB")


def fit_to_page(image: Image.Image) -> Image.Image:
    """The drawing cropped around its ink (plus FIT_MARGIN) and scaled up to fill the page, keeping its shape.
    A subject that already fills the page's width or height is only moved to the middle (a wide car left at the
    bottom of the page once the arc above it was erased: stray_lines.py). Returns the image unchanged when the subject
    already fills the page and is centered, or when there is no ink."""
    rgb = image.convert("RGB")
    ink = np.asarray(rgb.convert("L")) < INK_LEVEL
    if not ink.any():
        return image
    rows, cols = np.nonzero(ink.any(axis=1))[0], np.nonzero(ink.any(axis=0))[0]
    height, width = ink.shape
    side = max(rows[-1] - rows[0] + 1, cols[-1] - cols[0] + 1) / (1 - 2 * FIT_MARGIN)  # the square to keep
    scale = min(width / side, FIT_MAX_SCALE)
    cy, cx = (rows[0] + rows[-1]) / 2, (cols[0] + cols[-1]) / 2
    if scale < 1.05:
        if abs(cx - width / 2) <= CENTER_SLACK * width and abs(cy - height / 2) <= CENTER_SLACK * height:
            return image
        scale = 1.0
        cx, cy = round(cx), round(cy)  # whole pixels: moved, not resampled, so the lines stay sharp
    side = width / scale
    # The square around the subject may reach past the page's edge: the page's own color fills in there.
    page = np.median(np.asarray(rgb)[~ndimage.binary_dilation(ink, iterations=2)], axis=0)
    padded = Image.new("RGB", (width * 3, height * 3), tuple(int(v) for v in page))
    padded.paste(rgb, (width, height))
    box = (cx - side / 2 + width, cy - side / 2 + height, cx + side / 2 + width, cy + side / 2 + height)
    return padded.resize((width, height), Image.LANCZOS, box=box)
