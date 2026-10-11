"""A rough, explainable score for how clean a line drawing is. No GPU needed.

The pipeline needs drawings a beginner can copy and a tracer can turn into 6 to 60 strokes:
dark connected outlines on white, without specks, shading or solid fills. This scores exactly
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


def line_metrics(image: Image.Image) -> dict[str, float]:
    """Measures one drawing. Lower `score` is cleaner.

    - ink: share of the page that is ink
    - specks: tiny separate blobs of ink (noise)
    - pieces: separate ink shapes big enough to be lines (fewer = more connected outlines)
    - gray_ratio: mid-gray pixels per ink pixel. Smooth line edges give a little gray;
      shading and soft texture give a lot.
    """
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    ink_mask = gray < INK_LEVEL
    ink = float(ink_mask.mean())
    mid_gray = float(((gray >= 60) & (gray <= 200)).mean())
    gray_ratio = mid_gray / max(ink, 1e-6)

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
    )
    return {
        "ink": ink,
        "specks": specks,
        "pieces": pieces,
        "gray_ratio": gray_ratio,
        "score": score,
    }
