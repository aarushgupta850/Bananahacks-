"""Turns traced strokes into a lesson plan an artist would follow: tiers, order, steps and key points.

No GPU needed. Input: strokes from trace.py ((x, y) points in 768 x 768 space) and parts from parts.py.
Output: PlanStroke and Step dicts that match web/src/engine/types.ts.

How it decides:
- Construction: a light 48-point ellipse fitted to the head box and to the body box, drawn first
  (a rectangle for boxy objects like a mug or a house).
- Outline: strokes that run mostly along the outer silhouette (the drawing filled in, then its edge).
- Structure vs detail: other strokes longer than 8% of the drawing's diagonal are structure, shorter are detail.
- Part: the part box holding most of the stroke's points (the smallest box if several do), else none.
- Order: by tier (construction, outline, structure, detail). Within a tier, one part at a time (head and
  body first, then bigger parts before smaller ones), and from the center outward within a part, so a
  beginner finishes one part before moving to the next.
- Steps: 1 to 4 consecutive strokes with the same tier and part, with a template label. The first step of a
  part gets a tip with the part's real size; later steps get a tip for their tier.
- Key points: a stroke's ends, its corners (turns over 45 degrees) and, on smooth curves, its most bent
  points. The "hints" help level shows only these.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SIZE = 768
TIERS = ["construction", "outline", "structure", "detail"]
ELLIPSE_POINTS = 48
OUTLINE_PX = 6  # a stroke point this close to the silhouette's edge is "on the outline"
OUTLINE_SHARE = 0.7  # ...and a stroke is an outline stroke if this share of its points are
STRUCTURE_SHARE = 0.08  # inner strokes longer than this share of the drawing's diagonal are structure
SAMPLE_PX = 4  # strokes are sampled every few pixels when measuring them
CORNER_DEG = 45  # a turn sharper than this is a corner (a key point)
MAX_KEY_POINTS = 8
MAX_STEP_STROKES = 4
CONSTRUCTION_PARTS = ["head", "body"]  # parts that get a construction shape, in drawing order
CONSTRUCTION_BY_SUBJECT = {"house": ["wall"], "sneaker": []}  # subjects without a head and body
BOXY_SUBJECTS = {"mug", "house", "sneaker"}  # their construction shape is a rectangle, not an ellipse
MAX_SIZE_TIP_SHARE = 0.7  # a part taller than this share of the drawing gets no size tip ("100%" is no help)
TIER_TIPS = {
    "construction": "Draw light, loose shapes. They are only a guide.",
    "outline": "Follow the outer edge in smooth, confident strokes.",
    "structure": "Place the big inner lines before any small details.",
    "detail": "Press lightly and match the angle of the guide.",
}

Point = tuple[float, float]


# ---------------------------------------------------------------- small geometry helpers


def stroke_length(points: list[Point]) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def sample(points: list[Point], step: float = SAMPLE_PX) -> list[Point]:
    """Points every `step` pixels along the polyline, so long straight segments count fairly."""
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        n = max(1, int(math.dist(a, b) // step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out


def centroid(points: list[Point]) -> Point:
    xs, ys = zip(*points)
    return sum(xs) / len(xs), sum(ys) / len(ys)


def in_box(p: Point, box: list[float]) -> bool:
    x, y, w, h = box
    return x <= p[0] <= x + w and y <= p[1] <= y + h


def is_closed(points: list[Point]) -> bool:
    return len(points) > 2 and math.dist(points[0], points[-1]) < 3


def drawing_bounds(strokes: list[list[Point]]) -> tuple[float, float, float, float]:
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------- construction


def ellipse_in_box(box: list[float]) -> list[Point]:
    """A closed 48-point ellipse that fills the box, starting at the top and going clockwise."""
    x, y, w, h = box
    cx, cy, rx, ry = x + w / 2, y + h / 2, w / 2, h / 2
    pts = [
        (cx + rx * math.sin(2 * math.pi * k / ELLIPSE_POINTS), cy - ry * math.cos(2 * math.pi * k / ELLIPSE_POINTS))
        for k in range(ELLIPSE_POINTS)
    ]
    return pts + pts[:1]


def rectangle_in_box(box: list[float]) -> list[Point]:
    """A closed rectangle along the box's edges, starting at the top left and going clockwise."""
    x, y, w, h = box
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]


# ---------------------------------------------------------------- outline detection


def silhouette_edge_distance(strokes: list[list[Point]]) -> np.ndarray:
    """For every pixel, its distance to the edge of the drawing's filled-in silhouette."""
    canvas = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(canvas)
    for s in strokes:
        if len(s) > 1:
            draw.line(s, fill=255, width=3)
    lines = np.asarray(canvas) > 0
    # Close small gaps where strokes almost meet, so the inside can be filled.
    closed = ndimage.binary_closing(lines, iterations=4)
    filled = ndimage.binary_fill_holes(closed)
    edge = filled & ~ndimage.binary_erosion(filled)
    return ndimage.distance_transform_edt(~edge)


def is_outline(points: list[Point], edge_distance: np.ndarray) -> bool:
    pts = sample(points)
    near = sum(
        edge_distance[min(SIZE - 1, max(0, int(round(y)))), min(SIZE - 1, max(0, int(round(x))))] <= OUTLINE_PX
        for x, y in pts
    )
    return near >= OUTLINE_SHARE * len(pts)


# ---------------------------------------------------------------- parts


def part_of(points: list[Point], parts: list[dict]) -> str | None:
    """The part whose box holds most (over half) of the stroke's points; the smallest box wins ties,
    so an eye inside the head box belongs to the eye."""
    pts = sample(points)
    best = None  # (count, -area, id)
    for part in parts:
        count = sum(in_box(p, part["box"]) for p in pts)
        if count * 2 <= len(pts):
            continue
        key = (count, -part["box"][2] * part["box"][3], part["id"])
        if best is None or key[:2] > best[:2]:
            best = key
    return best[2] if best else None


# ---------------------------------------------------------------- key points


def _turn_deg(a: Point, b: Point, c: Point) -> float:
    """How sharply the path a -> b -> c turns at b, in degrees (0 = straight on)."""
    v1, v2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 == 0 or n2 == 0:
        return 0.0
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def key_points(points: list[Point]) -> list[Point]:
    """Ends, corners (turns over 45 degrees), and on smooth curves the most bent points."""
    closed = is_closed(points)
    pts = points[:-1] if closed else points
    keys: list[tuple[float, Point]] = []  # (importance, point)
    if not closed:
        keys += [(999.0, pts[0]), (999.0, pts[-1])]
    n = len(pts)
    turns = []
    for i in range(n):
        if not closed and (i == 0 or i == n - 1):
            continue
        turns.append((_turn_deg(pts[i - 1], pts[i], pts[(i + 1) % n]), pts[i]))
    corners = [t for t in turns if t[0] > CORNER_DEG]
    keys += corners
    if not corners:
        if closed:  # a smooth loop: its top, right, bottom and left
            keys += [(1.0, min(pts, key=lambda p: p[1])), (1.0, max(pts, key=lambda p: p[0])),
                     (1.0, max(pts, key=lambda p: p[1])), (1.0, min(pts, key=lambda p: p[0]))]
        elif turns:  # a smooth curve: the point that bulges furthest from the straight line between its ends
            a, b = pts[0], pts[-1]
            chord = math.dist(a, b) or 1.0

            def bulge(p: Point) -> float:
                return abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / chord

            peak = max(pts[1:-1], key=bulge)
            if bulge(peak) > 10:
                keys.append((1.0, peak))
    keys.sort(key=lambda k: -k[0])
    out: list[Point] = []
    for _, p in keys:
        q = (round(p[0]), round(p[1]))
        if q not in out:
            out.append(q)
        if len(out) == MAX_KEY_POINTS:
            break
    return out


# ---------------------------------------------------------------- steps


def step_label(tier: str, part: dict | None) -> str:
    name = part["label"].lower() if part else None
    if tier == "construction":
        return f"Block in the {name}" if name else "Block in the big shapes"
    if tier == "outline":
        return f"Outline the {name}" if name else "Outline the shape"
    if tier == "structure":
        return f"Add the {name}" if name else "Add the inner lines"
    return f"Add the {name}" if name else "Add the details"


def step_tip(tier: str, part: dict | None, drawing_height: float, first_for_part: bool) -> str:
    """The first step of a part says how big it is (from its real box), unless it fills most of the drawing.
    Every other step gets the tip for its tier."""
    if part and first_for_part and 0 < part["box"][3] <= MAX_SIZE_TIP_SHARE * drawing_height:
        percent = round(100 * part["box"][3] / drawing_height)
        return f"Keep the {part['label'].lower()} about {percent}% of the drawing height."
    return TIER_TIPS[tier]


def build_plan(strokes: list[list[Point]], parts: list[dict], subject: str | None = None) -> dict:
    """The lesson plan: {"strokes": [PlanStroke], "steps": [Step]}, in drawing order.
    `subject` (e.g. "fox", "mug") picks the construction shapes."""
    if not strokes:
        return {"strokes": [], "steps": []}
    x0, y0, x1, y1 = drawing_bounds(strokes)
    diagonal = math.hypot(x1 - x0, y1 - y0)
    center = ((x0 + x1) / 2, (y0 + y1) / 2)
    edge_distance = silhouette_edge_distance(strokes)
    by_id = {p["id"]: p for p in parts}
    construction = CONSTRUCTION_BY_SUBJECT.get(subject or "", CONSTRUCTION_PARTS)
    shape = rectangle_in_box if subject in BOXY_SUBJECTS else ellipse_in_box
    # Parts in drawing order: the construction parts first, then bigger parts before smaller ones.
    others = sorted((p for p in parts if p["id"] not in construction), key=lambda p: -p["box"][2] * p["box"][3])
    part_rank = {pid: n for n, pid in enumerate([*construction, *(p["id"] for p in others)])}

    planned = []  # (tier index, part rank, distance from center, PlanStroke)
    for name in construction:
        part = by_id.get(name)
        if part:
            pts = shape(part["box"])
            planned.append((0, part_rank[name], 0.0, {"id": f"c-{name}", "points": pts, "tier": "construction",
                                                      "partId": name, "keyPoints": key_points(pts)}))
    for points in strokes:
        if len(points) < 2:
            continue
        if is_outline(points, edge_distance):
            tier = "outline"
        elif stroke_length(points) > STRUCTURE_SHARE * diagonal:
            tier = "structure"
        else:
            tier = "detail"
        part_id = part_of(points, parts)
        rank = part_rank.get(part_id, len(part_rank))  # strokes without a part come after the parts
        planned.append((TIERS.index(tier), rank, math.dist(centroid(points), center), {
            "points": points, "tier": tier, "partId": part_id, "keyPoints": key_points(points),
        }))
    planned.sort(key=lambda t: t[:3])  # tier, then part, then center outward

    plan_strokes, steps = [], []
    parts_with_a_tip: set[str] = set()
    for n, (_, _, _, raw) in enumerate(planned, start=1):
        stroke = {  # same field order as PlanStroke in types.ts
            "id": raw.get("id", f"s-{n}"),
            "points": [[round(x), round(y)] for x, y in raw["points"]],
            "tier": raw["tier"],
            "partId": raw["partId"],
            "keyPoints": [[round(x), round(y)] for x, y in raw["keyPoints"]],
        }
        plan_strokes.append(stroke)
        last = steps[-1] if steps else None
        if last and last["tier"] == stroke["tier"] and last["_part"] == stroke["partId"] \
                and len(last["strokeIds"]) < MAX_STEP_STROKES:
            last["strokeIds"].append(stroke["id"])
        else:
            part = by_id.get(stroke["partId"])
            label = step_label(stroke["tier"], part)
            tip = step_tip(stroke["tier"], part, y1 - y0, first_for_part=part is not None
                           and part["id"] not in parts_with_a_tip)
            if part:
                parts_with_a_tip.add(part["id"])
            steps.append({"id": f"step-{len(steps) + 1}", "label": label, "tip": tip, "tier": stroke["tier"],
                          "strokeIds": [stroke["id"]], "_part": stroke["partId"]})
    for step in steps:
        del step["_part"]
    return {"strokes": plan_strokes, "steps": steps}
