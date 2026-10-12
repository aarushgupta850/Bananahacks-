"""Removes marks that are not part of the subject from a generated drawing, and spots a subject cut off at the
edge. No GPU needed.

SDXL-Lightning often draws more than the subject, and each extra mark would become a stroke the user has to copy
(and on the reference it looks like a mistake). Three kinds are removed, in this order:

1. Background rings: a big circle (or a few arcs of one) drawn behind the subject, like a badge. Each separate
   piece of ink that is a smooth arc of a big circle (radius at least RING_MIN_RADIUS) is fitted with a circle;
   the arc goes, and so does any other ink lying on that circle outside the subject (where the ring touches the
   subject, it joins the subject's own piece of ink).
2. Ground lines: thin, flat dashes under the subject (a floor, a shadow, speed lines under a car).
3. Stray marks: small separate pieces far from the subject (floating dashes, sparkles, specks, a scribble in a
   corner). The subject is every piece holding at least MAIN_SHARE of the ink, plus every piece linked to it
   through gaps of at most NEAR_PX (whiskers, a separate wheel, a dashed outline), plus every piece lying mostly
   inside its outline (eyes, buttons). If what is left is more than MAX_STRAY_SHARE of the ink, the separate
   marks are the drawing itself (stars, rain), and all of them stay.

Everything removed is painted over with the page's own color, including the faint gray edges around it, and so
are faint gray marks with no ink in them lying outside the subject (a pale ring that never got dark enough to be
ink would still show on the reference).
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import convex_hull_image

INK_LEVEL = 128     # gray value below this counts as ink (as in quality.py and frame.py)
DARK_LEVEL = 200    # gray value below this is drawn at all (faint gray marks included); the page is lighter
# Background rings, in 768 x 768 space. Measured on the shipped packs' unused drafts: ring arcs fit a circle to
# within 0.2-3.3% of its radius, with radii of 300-450 px; the subjects' own outlines fit no circle better than 18%.
RING_MIN_RADIUS = 200
RING_MAX_MISFIT = 0.04  # the spread of an arc's distances from its circle, as a share of the radius
RING_MIN_PX = 80        # pieces smaller than this are left to the stray-mark step
RING_BAND_PX = 10       # other marks this close to a ring's circle, outside the subject, are part of the ring
RING_SPARE_PX = 24      # ...but nothing this close to the subject goes (a fox's ear tips poking into the ring)
# Ground lines.
GROUND_MAX_HEIGHT = 14  # px: a flat dash
GROUND_MIN_RATIO = 4    # ...at least this many times wider than tall
GROUND_BELOW = 0.1      # ...starting no higher than this share of the subject's height above its bottom
# Stray marks.
MAIN_SHARE = 0.05       # a connected piece with at least this share of all the ink is part of the subject
NEAR_PX = 16            # pieces with gaps this small between them belong together
INSIDE_SHARE = 0.5      # a piece with at least this share of its ink inside the subject's outline belongs to it
MAX_STRAY_SHARE = 0.15  # strays are small extras: if they add up to more of the ink than this, they are the drawing
# Cut off.
EDGE_PX = 6       # ink this close to the image's edge means the subject runs off the page
CUT_OFF_PX = 40   # at least this many ink pixels along the edge: the subject is cut off, not just touching it


def _pieces(ink: np.ndarray) -> tuple[np.ndarray, int, np.ndarray]:
    """(labels, count, sizes): the connected pieces of ink (8-connectivity). sizes[0], the page, is 0."""
    labels, count = ndimage.label(ink, structure=np.ones((3, 3), dtype=int))
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    sizes[0] = 0
    return labels, count, sizes


def fit_circle(ys: np.ndarray, xs: np.ndarray) -> tuple[float, float, float, float]:
    """(center x, center y, radius, misfit) of the circle through these pixels (Kasa's least-squares fit). misfit
    is the spread of the pixels' distances from the circle as a share of the radius: 0 for a perfect arc."""
    x, y = xs.astype(float), ys.astype(float)
    a = np.c_[x, y, np.ones_like(x)]
    d, e, f = np.linalg.lstsq(a, -(x * x + y * y), rcond=None)[0]
    cx, cy = -d / 2, -e / 2
    radius = float(np.sqrt(max(cx * cx + cy * cy - f, 1e-9)))
    misfit = float(np.std(np.hypot(x - cx, y - cy) - radius) / radius)
    return float(cx), float(cy), radius, misfit


def _ring_marks(ink: np.ndarray, dark: np.ndarray, labels: np.ndarray, sizes: np.ndarray) -> np.ndarray:
    """Step 1: True on the ink (and faint marks) of background rings."""
    main = int(sizes.argmax())
    marks = np.zeros_like(ink)
    circles = []
    for label, box in enumerate(ndimage.find_objects(labels), start=1):
        if box is None or label == main or sizes[label] < RING_MIN_PX:
            continue
        ys, xs = np.nonzero(labels[box] == label)
        cx, cy, radius, misfit = fit_circle(ys + box[0].start, xs + box[1].start)
        if radius >= RING_MIN_RADIUS and misfit <= RING_MAX_MISFIT:
            circles.append((cx, cy, radius))
            marks[box] |= labels[box] == label
    if not circles:
        return marks
    # Ring ink that touches the subject is part of the subject's piece: take what lies on a ring's circle, outside
    # the subject (the convex hull of the subject's piece without the parts of it on a ring, plus a safety margin:
    # parts of the subject on the ring, like ear tips, are outside that hull but close to it).
    yy, xx = np.mgrid[: ink.shape[0], : ink.shape[1]]
    band = np.zeros_like(ink)
    for cx, cy, radius in circles:
        band |= np.abs(np.hypot(xx - cx, yy - cy) - radius) <= RING_BAND_PX
    core = (labels == main) & ~band
    if core.any():
        near_subject = ndimage.distance_transform_edt(~convex_hull_image(core)) <= RING_SPARE_PX
        marks |= dark & band & ~near_subject
    return marks


def _ground_marks(labels: np.ndarray, sizes: np.ndarray) -> np.ndarray:
    """Step 2: True on the ink of flat dashes under the subject."""
    main = int(sizes.argmax())
    rows = np.nonzero((labels == main).any(axis=1))[0]
    top, bottom = rows[0], rows[-1]
    ground = np.zeros(len(sizes), dtype=bool)
    for label, box in enumerate(ndimage.find_objects(labels), start=1):
        if box is None or label == main:
            continue
        height, width = box[0].stop - box[0].start, box[1].stop - box[1].start
        flat = height <= GROUND_MAX_HEIGHT and width >= GROUND_MIN_RATIO * height
        ground[label] = flat and box[0].start >= bottom - GROUND_BELOW * (bottom - top)
    return ground[labels]


def _stray_marks(ink: np.ndarray, labels: np.ndarray, sizes: np.ndarray) -> np.ndarray:
    """Step 3: True on the ink of small pieces far from the subject (or all False: see MAX_STRAY_SHARE)."""
    main = sizes >= MAIN_SHARE * sizes.sum()
    main[int(sizes.argmax())] = True
    main[0] = False
    main_ink = main[labels]
    # Grow every piece by half the gap: pieces closer than NEAR_PX then touch, and the groups that touch the main
    # pieces (directly or through a chain of others) belong to the subject.
    groups, _ = ndimage.label(ndimage.distance_transform_edt(~ink) <= NEAR_PX / 2, structure=np.ones((3, 3), int))
    linked = np.isin(groups, np.unique(groups[main_ink]))
    keep = np.zeros(len(sizes), dtype=bool)
    keep[np.unique(labels[ink & linked])] = True
    inside = np.bincount(labels[ink & convex_hull_image(main_ink)], minlength=len(sizes))
    keep |= inside >= INSIDE_SHARE * sizes
    stray = ~keep & (sizes > 0)
    if sizes[stray].sum() > MAX_STRAY_SHARE * sizes.sum():
        return np.zeros_like(ink)
    return stray[labels]


def remove_strays(image: Image.Image) -> Image.Image:
    """The drawing without background rings, ground lines and stray marks. Returns the image itself when there
    are none."""
    rgb = image.convert("RGB")
    gray = np.asarray(rgb.convert("L"))
    ink, dark = gray < INK_LEVEL, gray < DARK_LEVEL
    labels, count, sizes = _pieces(ink)
    if count < 2:
        return image
    marks = _ring_marks(ink, dark, labels, sizes) | _ground_marks(labels, sizes)
    rest = ink & ~marks
    labels, count, sizes = _pieces(rest)  # strays are judged on what is left without the rings and ground lines
    if count >= 2:
        marks |= _stray_marks(rest, labels, sizes)
    keep = ink & ~marks
    if not keep.any():
        return image
    # Faint marks: each connected patch of anything drawn (ink and the gray around it) goes if it holds no ink that
    # stays and either holds a removed mark or lies mostly outside the subject.
    patches, _ = _pieces(dark)[:2]
    n = int(patches.max()) + 1
    has_keep = np.bincount(patches[keep], minlength=n) > 0
    has_mark = np.bincount(patches[marks], minlength=n) > 0
    outside = np.bincount(patches[dark & ~convex_hull_image(keep)], minlength=n)
    gone = ~has_keep & (has_mark | (outside >= 0.5 * np.bincount(patches[dark], minlength=n)))
    gone[0] = False
    # Paint each mark over with its soft (anti-aliased) edge, but never a pixel right next to ink that stays.
    near_keep = ndimage.binary_dilation(keep, iterations=2)
    erase = gone[patches] | (ndimage.binary_dilation(marks, iterations=2) & ~near_keep)
    if not erase.any():
        return image
    pixels = np.asarray(rgb).copy()
    page = np.median(pixels[~ndimage.binary_dilation(ink, iterations=2)], axis=0)  # the page's own color
    pixels[erase] = page.astype(np.uint8)
    return Image.fromarray(pixels, "RGB")


def is_cut_off(image: Image.Image) -> bool:
    """True if the drawing runs off the edge of the image (a dog without its feet, a bust cut at the chest), so
    the lesson would teach an incomplete subject. Run after frame.remove_frame, which clears drawn borders."""
    ink = np.asarray(image.convert("L")) < INK_LEVEL
    band = np.zeros_like(ink)
    band[:EDGE_PX], band[-EDGE_PX:], band[:, :EDGE_PX], band[:, -EDGE_PX:] = True, True, True, True
    return int((ink & band).sum()) >= CUT_OFF_PX
