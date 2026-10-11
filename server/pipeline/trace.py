"""Turns a line drawing into strokes: polylines an artist would draw, in 768 x 768 space. No GPU needed.

The steps, in order:
1. Grayscale, then Otsu's threshold splits ink from paper. It picks the threshold from the image itself,
   so it works even though the generated backgrounds are light gray, not white.
2. Remove specks: ink blobs under 30 px are noise.
3. Skeletonize: thin every line to 1 px down its middle, so a thick outline becomes a single path.
4. Build a pixel graph (8-connectivity) and split it at endpoints and junctions into pieces.
5. Walk each piece into an ordered list of points. Closed loops (a circle) have no ends, so they are
   walked separately.
6. Drop tiny side spurs (under 15 px) that thinning leaves at the corners of thick lines.
7. Join pieces back into strokes. Where only two pieces meet, they are one line, so they are always joined.
   At a real junction (3 or more pieces), the pair that continues straightest is joined, if its direction
   changes by less than 30 degrees.
8. Solid dots (like eyes) thin down to almost nothing, so each one becomes a small circle stroke instead.
9. Simplify each stroke with Ramer-Douglas-Peucker (epsilon 1.5 px) to drop redundant points.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.filters import threshold_otsu
from skimage.measure import approximate_polygon
from skimage.morphology import skeletonize, thin

SIZE = 768  # all app coordinates are in 768 x 768 space
SPECK_PX = 30  # ink blobs smaller than this (in pixels) are noise
MIN_PIECE_PX = 15  # side spurs and stray bits shorter than this (in pixels of length) are dropped
MAX_TURN_DEG = 30  # at a junction, join two pieces only if the line turns less than this
# A piece's direction at a junction is measured between these two distances into the piece. The first few
# pixels are skipped because a thick line's center line bends toward the middle of the junction.
DIRECTION_SKIP_PX = 6
DIRECTION_PX = 24
DOT_POINTS = 12  # points in the small circle stroke that stands in for a solid dot
SIMPLIFY_PX = 1.5  # Ramer-Douglas-Peucker tolerance

# The 8 neighbors of a pixel, as (dy, dx).
NEIGHBORS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

Pixel = tuple[int, int]  # (row, column)


@dataclass
class Piece:
    """A run of skeleton pixels. start/end name the junction it touches, or None for a free end."""

    points: list[tuple[float, float]]  # (row, column); whole pixels, except for dot circles
    start: int | None
    end: int | None
    closed: bool = False

    def length(self) -> float:
        return sum(math.dist(a, b) for a, b in zip(self.points, self.points[1:]))


def ink_mask(image: Image.Image) -> np.ndarray:
    """Steps 1-2: True where there is ink, specks removed. The image is resized to 768 x 768 first."""
    if image.size != (SIZE, SIZE):
        image = image.resize((SIZE, SIZE), Image.LANCZOS)
    gray = np.asarray(image.convert("L"))
    if int(gray.max()) - int(gray.min()) < 30:  # a blank page: no ink to find
        return np.zeros(gray.shape, dtype=bool)
    # Otsu counts values above its threshold as paper, so ink is "at or below" (with only two gray
    # levels in the image, the threshold is the ink level itself).
    ink = gray <= threshold_otsu(gray)
    # Label connected ink blobs (8-connectivity) and keep only those of SPECK_PX pixels or more.
    labels, count = ndimage.label(ink, structure=np.ones((3, 3), dtype=int))
    if count == 0:
        return ink
    sizes = np.bincount(labels.ravel())
    keep = sizes >= SPECK_PX
    keep[0] = False  # label 0 is the paper
    return keep[labels]


def skeleton_of(ink: np.ndarray) -> np.ndarray:
    """Step 3: 1-px-wide center lines. thin() after skeletonize() removes the extra pixels that
    skeletonize leaves on diagonal corners, which would otherwise look like junctions."""
    return thin(skeletonize(ink))


def trace(image: Image.Image) -> list[list[tuple[float, float]]]:
    """Traces a drawing into strokes: each a list of (x, y) points in 768 x 768 space, longest first."""
    ink = ink_mask(image)
    pieces = split_into_pieces(skeleton_of(ink))
    pieces = drop_spurs(pieces)
    strokes = join_pieces(pieces) + dots_without_strokes(ink, pieces)
    result = []
    for stroke in sorted(strokes, key=lambda p: -p.length()):
        points = np.array(stroke.points, dtype=float)
        if stroke.closed:
            points = np.vstack([points, points[:1]])  # repeat the first point so the loop closes
        simple = approximate_polygon(points, tolerance=SIMPLIFY_PX)
        result.append([(float(x), float(y)) for y, x in simple])  # (row, col) -> (x, y)
    return result


# ---------------------------------------------------------------- step 4-5: pixel graph -> pieces


def split_into_pieces(skeleton: np.ndarray) -> list[Piece]:
    """Steps 4-5: splits the skeleton at endpoints and junctions, and walks each piece in order."""
    pixels = set(zip(*np.nonzero(skeleton)))
    pixels = {(int(y), int(x)) for y, x in pixels}

    def neighbors(p: Pixel) -> list[Pixel]:
        return [(p[0] + dy, p[1] + dx) for dy, dx in NEIGHBORS if (p[0] + dy, p[1] + dx) in pixels]

    degree = {p: len(neighbors(p)) for p in pixels}
    # Junction pixels (3+ neighbors) often come in small clumps; each clump is one junction.
    junction_mask = np.zeros(skeleton.shape, dtype=bool)
    for p, d in degree.items():
        if d >= 3:
            junction_mask[p] = True
    labels, _ = ndimage.label(junction_mask, structure=np.ones((3, 3), dtype=int))

    def junction(p: Pixel) -> int | None:
        return int(labels[p]) if labels[p] else None

    def is_node(p: Pixel) -> bool:  # an end or a junction: where pieces start and stop
        return degree[p] != 2

    pieces: list[Piece] = []
    used: set[Pixel] = set()  # middle pixels already walked, so no piece is walked twice
    for start in sorted(p for p in pixels if is_node(p)):
        for first in neighbors(start):
            if junction(first) is not None and junction(first) == junction(start):
                continue  # a step inside the same junction clump, not a piece
            if is_node(first):  # two nodes side by side: a 2-pixel piece, added once
                if start < first:
                    pieces.append(Piece([start, first], junction(start), junction(first)))
                continue
            if first in used:
                continue
            path, prev, cur = [start, first], start, first
            used.add(first)
            while not is_node(cur):
                following = [n for n in neighbors(cur) if n != prev]
                if not following:
                    break
                prev, cur = cur, following[0]
                path.append(cur)
                if not is_node(cur):
                    used.add(cur)
            pieces.append(Piece(path, junction(start), junction(cur) if is_node(cur) else None))

    # Whatever middle pixels are left belong to closed loops with no ends or junctions (a circle).
    for begin in sorted(p for p in pixels if degree[p] == 2 and p not in used):
        if begin in used:
            continue
        path, prev, cur = [begin], None, begin
        used.add(begin)
        while True:
            following = [n for n in neighbors(cur) if n != prev and (n not in used or n == begin)]
            if not following or following[0] == begin:
                break
            prev, cur = cur, following[0]
            path.append(cur)
            used.add(cur)
        pieces.append(Piece(path, None, None, closed=True))
    return pieces


# ---------------------------------------------------------------- step 6: spurs


def drop_spurs(pieces: list[Piece]) -> list[Piece]:
    """Step 6: drops short pieces with a free end (corner spurs, stray bits) and tiny closed loops.
    Short pieces between two junctions are kept: they connect real lines."""
    kept = []
    for piece in pieces:
        free_end = piece.start is None or piece.end is None
        if piece.length() < MIN_PIECE_PX and (free_end or piece.closed):
            continue
        kept.append(piece)
    return kept


# ---------------------------------------------------------------- step 7: joining


def _direction(piece: Piece, at_start: bool) -> tuple[float, float]:
    """Unit vector pointing from the junction end of a piece into the piece."""
    points = piece.points if at_start else piece.points[::-1]
    last = len(points) - 1
    a, b = points[min(DIRECTION_SKIP_PX, last // 2)], points[min(DIRECTION_PX, last)]
    dy, dx = b[0] - a[0], b[1] - a[1]
    norm = math.hypot(dy, dx) or 1.0
    return dy / norm, dx / norm


def _turn_deg(u: tuple[float, float], v: tuple[float, float]) -> float:
    """How much a line turns passing through a junction. u and v both point away from the junction,
    so a perfectly straight line has them opposite (180 degrees apart): a turn of 0."""
    cos = max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1]))
    return 180.0 - math.degrees(math.acos(cos))


def join_pieces(pieces: list[Piece]) -> list[Piece]:
    """Step 7: joins pieces through junctions, straightest pair first, until nothing more can join."""
    pieces = list(pieces)
    while True:
        # Every piece end that touches a junction, grouped by junction: (piece index, at its start?).
        ends: dict[int, list[tuple[int, bool]]] = {}
        for i, piece in enumerate(pieces):
            if piece.closed:
                continue
            if piece.start is not None:
                ends.setdefault(piece.start, []).append((i, True))
            if piece.end is not None:
                ends.setdefault(piece.end, []).append((i, False))

        best = None  # (turn, end a, end b)
        for node_ends in ends.values():
            for n, a in enumerate(node_ends):
                for b in node_ends[n + 1 :]:
                    turn = _turn_deg(_direction(pieces[a[0]], a[1]), _direction(pieces[b[0]], b[1]))
                    # Only two ends here: one line passing through, whatever its angle.
                    if len(node_ends) == 2:
                        turn = -1.0
                    if turn < MAX_TURN_DEG and (best is None or turn < best[0]):
                        best = (turn, a, b)
        if best is None:
            return pieces

        _, (i, i_at_start), (j, j_at_start) = best
        if i == j:  # both ends of one piece meet: it closes into a loop
            pieces[i] = Piece(pieces[i].points, None, None, closed=True)
            continue
        first, second = pieces[i], pieces[j]
        # Orient so the joined ends meet in the middle: first ... junction ... second.
        a_points = first.points[::-1] if i_at_start else first.points
        a_other = first.end if i_at_start else first.start  # the end of `first` away from the junction
        b_points = second.points if j_at_start else second.points[::-1]
        b_other = second.end if j_at_start else second.start
        joined = Piece(a_points + b_points, a_other, b_other)
        pieces = [p for k, p in enumerate(pieces) if k not in (i, j)] + [joined]


# ---------------------------------------------------------------- step 8: dots


def dots_without_strokes(ink: np.ndarray, pieces: list[Piece]) -> list[Piece]:
    """Step 8: every ink blob that no stroke passes through (a solid dot, like an eye) becomes a small
    closed circle around its center, sized from its area, so the lesson still has the detail."""
    labels, count = ndimage.label(ink, structure=np.ones((3, 3), dtype=int))
    covered = {int(labels[p]) for piece in pieces for p in piece.points}
    dots = []
    for label in range(1, count + 1):
        if label in covered:
            continue
        ys, xs = np.nonzero(labels == label)
        cy, cx = float(ys.mean()), float(xs.mean())
        radius = max(3.0, math.sqrt(len(ys) / math.pi) * 0.6)  # a bit inside the dot's own edge
        circle = [
            (cy + radius * math.sin(2 * math.pi * k / DOT_POINTS), cx + radius * math.cos(2 * math.pi * k / DOT_POINTS))
            for k in range(DOT_POINTS)
        ]
        dots.append(Piece(circle, None, None, closed=True))
    return dots
