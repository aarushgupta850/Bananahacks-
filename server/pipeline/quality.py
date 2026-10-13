"""A rough, explainable score for how clean a line drawing is. No GPU needed.

The pipeline needs drawings a beginner can copy and a tracer can turn into 6 to 60 strokes:
dark connected outlines on white, without specks, shading, solid fills or color. This scores exactly
those problems so candidates and prompts can be compared automatically. A person should still
look at the images; the score only ranks them.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

INK_LEVEL = 128  # gray value below this counts as ink
SPECK_PX = 30  # ink blobs smaller than this are specks (the tracer drops them as noise)
MAX_CLEAN_INK = 0.15  # more ink than this (share of the page) means solid fills or dense hatching
MIN_INK = 0.005  # less than this means an (almost) empty page
MAX_COLOR = 0.15  # mean chroma of the drawn pixels above this means a colored drawing, not line art


def line_metrics(image: Image.Image) -> dict[str, float]:
    """Measures one drawing. Lower `score` is cleaner.

    - ink: share of the page that is ink
    - specks: tiny separate blobs of ink (noise)
    - pieces: separate ink shapes big enough to be lines (fewer = more connected outlines)
    - gray_ratio: mid-gray pixels per ink pixel. Smooth line edges give a little gray;
      shading and soft texture give a lot.
    - color: how colorful the drawn (non-background) pixels are, 0 = pure grays, 1 = fully saturated.
      Uses chroma (max - min of R, G, B), which stays near 0 for black, white and gray, even for
      nearly-black pixels with a slight tint, unlike HSV saturation.
    """
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    ink_mask = gray < INK_LEVEL
    ink = float(ink_mask.mean())
    mid_gray = float(((gray >= 60) & (gray <= 200)).mean())
    gray_ratio = mid_gray / max(ink, 1e-6)

    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    drawn = gray < 200  # everything that isn't (light) background
    color = float(chroma[drawn].mean() / 255) if drawn.any() else 0.0

    # Label connected ink blobs (8-connectivity, so diagonal pixels count as touching).
    labels, count = ndimage.label(ink_mask, structure=np.ones((3, 3), dtype=int))
    sizes = np.bincount(labels.ravel())[1:] if count else np.zeros(0, dtype=int)
    specks = int((sizes < SPECK_PX).sum())
    pieces = int((sizes >= SPECK_PX).sum())

    score = (
        specks
        + 0.5 * pieces
        + 50 * gray_ratio
        + 500 * max(0.0, ink - MAX_CLEAN_INK)  # solid fills and dense hatching
        + (1000 if ink < MIN_INK else 0)  # a blank page is never the cleanest
        + (1000 if color > MAX_COLOR else 0)  # a colored drawing is never usable line art
    )
    return {
        "ink": ink,
        "specks": specks,
        "pieces": pieces,
        "gray_ratio": gray_ratio,
        "color": color,
        "score": score,
    }


SYMMETRY_SIZE = 192  # the drawing is compared with its mirror image at this size (fast, and forgiving of a pixel)
SYMMETRY_SLACK_PX = 3  # at that size, ink within this distance of the mirrored ink counts as matching


def symmetry(image: Image.Image) -> float:
    """How mirror-symmetric the drawing is, left to right, from 0 to 1: the share of its ink that lies on (or within
    SYMMETRY_SLACK_PX of) the ink of its own mirror image, mirrored about the middle of the drawing (not the page).
    A clean basketball or a front-on face scores near 1; wobbly, lopsided seams score lower. A side view (a cat
    walking, a mug with its handle) is rightly asymmetric, so this only breaks ties between near-equal drafts."""
    gray = np.asarray(image.convert("L").resize((SYMMETRY_SIZE, SYMMETRY_SIZE)), dtype=np.uint8)
    ink = gray < INK_LEVEL
    if ink.sum() < 10:
        return 0.0
    cols = np.flatnonzero(ink.any(axis=0))
    left, right = int(cols[0]), int(cols[-1])
    drawing = ink[:, left:right + 1]
    mirror = drawing[:, ::-1]
    near_mirror = ndimage.binary_dilation(mirror, iterations=SYMMETRY_SLACK_PX)
    return float((drawing & near_mirror).sum() / drawing.sum())
