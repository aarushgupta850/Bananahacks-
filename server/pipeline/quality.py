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
MAX_SOLID_INK = 0.35  # more ink than this is a mostly black page (a dragon drawn as black shapes), never line art


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
        + (1000 if ink > MAX_SOLID_INK else 0)  # nor is a page that is mostly black
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


SUBJECTS_SIZE = 192  # separate_subjects works on the drawing at this size
SUBJECTS_JOIN_PX = 2  # at that size, ink this close counts as one shape (8 px at full size)
SUBJECTS_MIN_SHARE = 0.08  # a shape whose box covers at least this share of the whole drawing's box is a subject


def _subject_boxes(image: Image.Image) -> tuple[np.ndarray, list[tuple[int, int, int, int, int]]]:
    """The drawing's separate big shapes, at SUBJECTS_SIZE: a label map, and each shape's (top, bottom, left, right,
    label), biggest first. A shape lying mostly inside a bigger one (a window inside a house, a mug's inner mark)
    doesn't count."""
    gray = np.asarray(image.convert("L").resize((SUBJECTS_SIZE, SUBJECTS_SIZE)), dtype=np.uint8)
    ink = gray < INK_LEVEL
    if ink.sum() < 10:
        return np.zeros_like(ink, dtype=int), []
    labels, _ = ndimage.label(ndimage.binary_dilation(ink, iterations=SUBJECTS_JOIN_PX))
    rows, cols = np.nonzero(ink)
    whole = (np.ptp(rows) + 1) * (np.ptp(cols) + 1)
    boxes = [(s[0].start, s[0].stop, s[1].start, s[1].stop, i + 1) for i, s in enumerate(ndimage.find_objects(labels))]

    def area(b) -> int:
        return (b[1] - b[0]) * (b[3] - b[2])

    def mostly_inside(a, b) -> bool:
        overlap = max(0, min(a[1], b[1]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[2], b[2]))
        return overlap >= 0.5 * area(a)

    big = [b for b in boxes if area(b) >= SUBJECTS_MIN_SHARE * whole]
    top = [b for b in big if not any(b is not o and area(o) > area(b) and mostly_inside(b, o) for o in big)]
    return labels, sorted(top, key=area, reverse=True)


def separate_subjects(image: Image.Image) -> int:
    """How many separate, big shapes the drawing has: 1 for one subject, 2 for two cars stacked or a sneaker with a
    loose sole drawn beside it. A shape counts if its bounding box covers at least SUBJECTS_MIN_SHARE of the whole
    drawing's, and isn't mostly inside a bigger one's (a window inside a house, a mug's inner mark). On 815 live drafts
    it flagged 25, nearly all of them two subjects, a ring around the subject or a drawing broken in two."""
    return len(_subject_boxes(image)[1])


def biggest_subject(image: Image.Image) -> Image.Image | None:
    """The drawing's biggest separate shape alone, centered on a blank page of the same colour, or None when the
    drawing has just one. The last resort when every draft drew several subjects: "a car" once came back as a sheet
    of six cars in both drafts, and one car makes a far better lesson than six. (fit_to_page then scales it up.)"""
    labels, boxes = _subject_boxes(image)
    if len(boxes) < 2:
        return None
    rgb = image.convert("RGB")
    width, height = rgb.size
    top, bottom, left, right, _ = boxes[0]
    sy, sx = height / SUBJECTS_SIZE, width / SUBJECTS_SIZE
    box = (int(left * sx), int(top * sy), int(right * sx), int(bottom * sy))
    pixels = np.asarray(rgb).copy()
    drawn = np.asarray(rgb.convert("L")) < 200
    page = np.median(pixels[~drawn], axis=0) if (~drawn).any() else np.array([255, 255, 255])
    # The other subjects' ink goes, even where an edge pokes into this one's box (the next car's roof). Details
    # inside this one that aren't joined to its outline (windows, eyes) are separate shapes too, and stay.
    others = np.isin(labels, [b[4] for b in boxes[1:]]).astype(np.uint8) * 255
    pixels[np.asarray(Image.fromarray(others).resize((width, height))) > 0] = page.astype(np.uint8)
    # A fresh page, not the old one with the other shapes painted over: that left their faint gray edges behind.
    alone = Image.new("RGB", (width, height), tuple(int(v) for v in page))
    alone.paste(Image.fromarray(pixels).crop(box), ((width - (box[2] - box[0])) // 2, (height - (box[3] - box[1])) // 2))
    return alone
