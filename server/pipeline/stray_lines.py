"""Finds and erases long stray lines that are joined to the subject: a big arc swooping over a car, the arc of a
background ring that touches a fox's ear, a ground line running off from a wheel. No GPU needed.

strays.remove_strays already removes marks that are separate from the subject, and has_ring spots a whole ring
centered on the page. Neither catches a stray line that touches the subject (it is part of the subject's piece of
ink) and isn't a centered ring, so it became strokes the user had to copy. This works on the traced strokes:

1. The subject's body: the drawing's ink, slightly thickened, with every closed shape filled in (an outline that runs
   off the page is closed along that edge first, as for a bust), then thinned so that open lines drop out.
2. Each traced stroke is split into stretches far from that body (more than FAR_PX away).
3. A far stretch is a stray when all of these hold:
   - it is long (at least MIN_PX): short marks are left to the other cleanups, and whiskers stay;
   - it has a loose end (the stroke ends out there): a line joining two parts of the subject (a flower's stem) stays;
   - it is a smooth arc of a big circle, or a flat dash (a ground line): wavy lines like a tail or a string stay;
   - most of it lies outside the convex hull of the rest of the drawing: a line inside the subject (a jacket's
     lapel, a cat's inner leg) stays, even when the subject's outline isn't closed.

Tested on the repo's 44 saved SDXL drafts: it finds the background-ring arcs on cat-simple 0 and fox-medium 0 and
nothing else; on a live car lesson it finds both arcs over the car.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.draw import line as draw_line
from skimage.morphology import convex_hull_image, disk

from pipeline.strays import fit_circle
from pipeline.trace import points_along

INK_LEVEL = 128     # gray value below this counts as ink (as in strays.py)
SIZE = 768
CLOSE_PX = 4        # the ink is thickened this much before filling, so small gaps in an outline don't leak
EDGE_PX = 6         # ink this close to the page's edge closes an outline along that edge
OPEN_PX = 10        # after filling, anything thinner than about twice this (open lines) is not body
FAR_PX = 20         # a stretch of a stroke farther than this from the body is judged
MIN_PX = 100        # ...if it is at least this long
ARC_RADIUS = (100, 2000)  # an arc's circle has a radius in this range...
ARC_MISFIT = 0.06         # ...fits it this closely (strays.fit_circle's misfit)...
ARC_TURN_DEG = 25         # ...and turns at least this much (else it's a nearly straight line)
FLAT_HEIGHT_PX = 14       # a flat dash: at most this tall...
FLAT_RATIO = 4            # ...and this many times wider than tall
DASH_SLOPE = 0.2          # ...or, if longer, rising at most this much over its width
ON_CIRCLE_PX = 6          # points this close to a stray arc's circle lie on it (more pieces of the same arc)
PIECE_PX = 20             # ...and a far stretch at least this long lying on it goes too
TOUCH_PX = 4              # a stray is erased up to this close to the body (the stub where an arc meets the subject)
TWIN_PX = 25              # a far stretch running alongside a stray, this close to it all along, goes too (double lines)
TWIN_OUTSIDE_SHARE = 0.3  # ...with at least this share outside the hull (the twin itself stretches the hull)
HULL_MARGIN_PX = 10       # the rest of the drawing's convex hull, grown by this much
OUTSIDE_SHARE = 0.6       # a stray has at least this share of its points outside that hull
CANDIDATE_REACH_PX = 8    # ink this close to a candidate stray's line is left out of "the rest of the drawing"


def body_mask(image: Image.Image) -> np.ndarray:
    """True on the subject's body: its closed shapes filled in, without open lines (step 1)."""
    ink = np.asarray(image.convert("L")) < INK_LEVEL
    grown = ndimage.binary_dilation(ink, iterations=CLOSE_PX)
    # An outline that runs off the page (a bust cut at the chest) is closed along that edge, from the first to the
    # last place the ink touches it, so the shape inside it fills.
    edges = [(np.s_[:EDGE_PX, :], 0), (np.s_[-EDGE_PX:, :], 0), (np.s_[:, :EDGE_PX], 1), (np.s_[:, -EDGE_PX:], 1)]
    for band, axis in edges:
        touching = np.nonzero(grown[band].any(axis=axis))[0]
        if len(touching) >= 2:
            a, b = touching[0], touching[-1] + 1
            if axis == 0:  # top or bottom edge: a run of columns
                grown[band][:, a:b] = True
            else:          # left or right edge: a run of rows
                grown[band][a:b, :] = True
    filled = ndimage.binary_fill_holes(grown)
    return ndimage.binary_opening(filled, structure=disk(OPEN_PX))


def _length(points: np.ndarray) -> float:
    return float(np.hypot(*np.diff(points, axis=0).T).sum()) if len(points) > 1 else 0.0


def _circle(points: np.ndarray) -> tuple[float, float, float] | None:
    """(center x, center y, radius) if the points are a smooth arc of a big circle (ARC_*), else None."""
    cx, cy, radius, misfit = fit_circle(points[:, 1], points[:, 0])
    angles = np.unwrap(np.arctan2(points[:, 1] - cy, points[:, 0] - cx))
    turn = abs(angles[-1] - angles[0]) * 180 / np.pi
    if ARC_RADIUS[0] <= radius <= ARC_RADIUS[1] and misfit <= ARC_MISFIT and turn >= ARC_TURN_DEG:
        return cx, cy, radius
    return None


def _is_dash(points: np.ndarray) -> bool:
    """A ground line: long and flat (it may slope a little)."""
    height = points[:, 1].max() - points[:, 1].min()
    width = points[:, 0].max() - points[:, 0].min()
    return height <= max(FLAT_HEIGHT_PX, DASH_SLOPE * width) and width >= FLAT_RATIO * max(height, 1)


def _on_circle(points: np.ndarray, circle) -> np.ndarray:
    cx, cy, radius = circle
    return np.abs(np.hypot(points[:, 0] - cx, points[:, 1] - cy) - radius) <= ON_CIRCLE_PX


def _pixels(points: np.ndarray, shape) -> np.ndarray:
    """A 1 px line along the points."""
    mask = np.zeros(shape, dtype=bool)
    p = np.clip(np.round(points).astype(int), 0, [shape[1] - 1, shape[0] - 1])
    for (x0, y0), (x1, y1) in zip(p[:-1], p[1:]):
        rr, cc = draw_line(y0, x0, y1, x1)
        mask[rr, cc] = True
    return mask


def _far_stretches(points: np.ndarray, far: np.ndarray) -> list[tuple[int, int]]:
    """(first, last) index of each run of consecutive far points."""
    runs, i = [], 0
    while i < len(points):
        if far[i]:
            j = i
            while j + 1 < len(points) and far[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    return runs


def find_strays(image: Image.Image, strokes: list) -> list[tuple[int, int, int]]:
    """The stray stretches as (stroke index, first point, last point), points counted along points_along(stroke)."""
    gray = image.convert("L")
    body = body_mask(gray)
    if not body.any() or not strokes:
        return []
    to_body = ndimage.distance_transform_edt(~body)
    lines = [np.asarray(points_along(stroke), dtype=float) for stroke in strokes]

    def distance(points):
        cols = np.clip(points[:, 0].astype(int), 0, body.shape[1] - 1)
        rows = np.clip(points[:, 1].astype(int), 0, body.shape[0] - 1)
        return to_body[rows, cols]

    stretches = []  # every far stretch: (stroke, first, last)
    for index, points in enumerate(lines):
        if len(points) >= 2:
            stretches += [(index, i, j) for i, j in _far_stretches(points, distance(points) > FAR_PX)]
    candidates = []  # (stroke, first, last, circle or None)
    for index, i, j in stretches:
        points = lines[index]
        stretch = points[i:j + 1]
        loose = i == 0 or j == len(points) - 1  # the stroke ends out here
        if not loose or _length(stretch) < MIN_PX:
            continue
        circle = _circle(stretch)
        if circle is not None or _is_dash(stretch):
            candidates.append((index, i, j, circle))
    if not candidates:
        return []
    # More pieces of the same arcs: an arc that passes close to the subject (a ring grazing an ear tip) is cut into
    # several far stretches, and the short ones don't pass the tests above on their own.
    circles = [c for *_, c in candidates if c is not None]
    taken = {(k, i, j) for k, i, j, _ in candidates}
    for index, i, j in stretches:
        stretch = lines[index][i:j + 1]
        if (index, i, j) in taken or _length(stretch) < PIECE_PX:
            continue
        for circle in circles:
            if _on_circle(stretch, circle).mean() >= 0.9:
                candidates.append((index, i, j, circle))
                break

    # Step 3's last test: outside the rest of the drawing (all ink but the candidates).
    ink = np.asarray(gray) < INK_LEVEL
    near_candidates = np.zeros_like(ink)
    for index, i, j, _ in candidates:
        near_candidates |= _pixels(lines[index][i:j + 1], ink.shape)
    near_candidates = ndimage.binary_dilation(near_candidates, iterations=CANDIDATE_REACH_PX)
    rest = ndimage.binary_opening(ink & ~near_candidates)  # without single stray pixels
    if not rest.any():
        return []
    hull = ndimage.binary_dilation(convex_hull_image(rest), iterations=HULL_MARGIN_PX)
    def outside(stretch, share=OUTSIDE_SHARE):
        cols = np.clip(stretch[:, 0].astype(int), 0, ink.shape[1] - 1)
        rows = np.clip(stretch[:, 1].astype(int), 0, ink.shape[0] - 1)
        return 1 - hull[rows, cols].mean() >= share

    confirmed = [c for c in candidates if outside(lines[c[0]][c[1]:c[2] + 1])]
    # Twins: AI drawings often draw a ring as a double line, and the inner one may be too short or too straight to
    # pass on its own. A far stretch running alongside a stray all the way is part of it.
    if confirmed:
        alongside = np.zeros_like(ink)
        for index, i, j, _ in confirmed:
            alongside |= _pixels(lines[index][i:j + 1], ink.shape)
        alongside = ndimage.distance_transform_edt(~alongside) <= TWIN_PX
        taken = {(k, i, j) for k, i, j, _ in confirmed}
        for index, i, j in stretches:
            stretch = lines[index][i:j + 1]
            if (index, i, j) in taken or _length(stretch) < PIECE_PX or not outside(stretch, TWIN_OUTSIDE_SHARE):
                continue
            cols = np.clip(stretch[:, 0].astype(int), 0, ink.shape[1] - 1)
            rows = np.clip(stretch[:, 1].astype(int), 0, ink.shape[0] - 1)
            if alongside[rows, cols].mean() >= 0.9:
                confirmed.append((index, i, j, None))
    strays = []
    for index, i, j, circle in confirmed:
        points = lines[index]
        # Erase it right up to the subject: extend it along the stroke while the stroke still follows the arc (or,
        # for a dash, at all) and stays off the body, so no stub is left where it met the subject.
        near = distance(points)

        def follows(k):
            return near[k] > TOUCH_PX and (circle is None or _on_circle(points[k:k + 1], circle)[0])

        while i > 0 and follows(i - 1):
            i -= 1
        while j < len(points) - 1 and follows(j + 1):
            j += 1
        strays.append((index, i, j))
    return strays


def split_off(strokes: list, strays: list[tuple[int, int, int]]) -> tuple[list, list]:
    """(kept, dropped) strokes: each stroke with stray stretches is cut into its stray pieces (dropped) and the rest
    (kept, pieces of at least 2 points). Strokes are lists of (x, y) points, as trace() makes them."""
    by_stroke: dict[int, list[tuple[int, int]]] = {}
    for index, i, j in strays:
        by_stroke.setdefault(index, []).append((i, j))
    kept, dropped = [], []
    for index, stroke in enumerate(strokes):
        if index not in by_stroke:
            kept.append(stroke)
            continue
        points = [tuple(p) for p in points_along(stroke)]
        start = 0
        for i, j in sorted(by_stroke[index]):
            if i - start >= 2:
                kept.append(points[start:i])
            dropped.append(points[i:j + 1])
            start = j + 1
        if len(points) - start >= 2:
            kept.append(points[start:])
    return kept, dropped


def stray_share(strokes: list, strays: list[tuple[int, int, int]]) -> float:
    """The strays' share of the drawing's total line length (0 to 1)."""
    total = sum(_length(np.asarray(points_along(s), dtype=float)) for s in strokes)
    gone = sum(_length(np.asarray(points_along(strokes[k]), dtype=float)[i:j + 1]) for k, i, j in strays)
    return gone / total if total else 0.0
