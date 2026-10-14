"""Builds one subject pack (images + pack.json) for web/public/subjects, in one command.

Run from the repo root, with server/.venv active (needs the GPU). The /build-pack skill calls it like this:
    python server/build_pack.py --subject fox --difficulty medium --prompt "fox"
    python server/build_pack.py --subject mug --difficulty medium --photo server/scripts/test_photo.jpg

What it does:
1. Generates 4 candidate drawings (from the prompt, or redrawn from the photo's lines).
2. Traces each into strokes, and keeps the cleanest candidate (quality score) inside the 6-60 stroke gate
   (colored or blank drawings are never kept). If none fits, it tries 4 new seeds once, then stops
   with a clear message.
3. Finds the parts (OWLv2) and builds the lesson plan (tiers, order, steps).
4. Checks the whole pack against pipeline/schema.py (a mirror of types.ts) BEFORE writing anything.
5. Writes web/public/subjects/<subject>-<difficulty>/: target.png (768, the chosen drawing cleaned to black on white),
   thumb.png (256), pack.json, and pipeline/ images for the "How this lesson was made" panel
   (candidate-0..3, skeleton, parts, plus source for photo packs; webp, 300 KB or less each).
6. Adds the pack to web/public/subjects/index.json, keeping every other subject as it was.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline import openai_images, schema  # noqa: E402
from pipeline.order import build_plan  # noqa: E402
from pipeline.prompts import active_variant, line_art_prompt, openai_prompt  # noqa: E402
from pipeline.quality import biggest_subject, line_metrics, separate_subjects, symmetry  # noqa: E402
from pipeline.frame import fit_to_page, remove_frame  # noqa: E402
from pipeline.stray_lines import find_strays, split_off, stray_share  # noqa: E402
from pipeline.strays import has_ring, is_cut_off, remove_strays  # noqa: E402
from pipeline.trace import ink_mask, points_along, skeleton_of, trace  # noqa: E402
from scripts.download_models import image_model, lightning_steps  # noqa: E402

SUBJECTS_DIR = SERVER_DIR.parent / "web" / "public" / "subjects"
DIFFICULTIES = ["simple", "medium", "detailed"]  # must match Difficulty in web/src/engine/types.ts
N_CANDIDATES = 4
RETRY_SEED_OFFSET = 100  # the retry uses seeds this far from the first try's
REVIEW_SEED_OFFSET = 500  # make_pack: the drafts asked for again after a failed review use seeds this far away
DETAIL_SEED_OFFSET = 700  # make_pack: drafts asked for again with more detail (all too simple) use seeds this far away
MIN_STROKES, MAX_STROKES = 6, 60  # the quality gate (server/CLAUDE.md)
SIMPLE_MAX_STROKES = 25  # rate_difficulty: a drawing with at most this many strokes is "simple"...
MEDIUM_MAX_STROKES = 50  # ...at most this many "medium", more "detailed"
REJECTED_SCORE = 1000  # quality.py adds 1000 for a colored or blank drawing
MAX_IMAGE_BYTES = 300 * 1024  # pipeline images must be 300 KB or less
SIZE = 768


class NoCleanCandidate(Exception):
    """No generated drawing fit the stroke gate with a clean score."""


@dataclass
class Candidate:
    image: Image.Image
    strokes: list
    score: float
    cut_off: bool = False  # the subject runs off the edge of the image (strays.is_cut_off)
    ringed: bool = False   # a background ring is still joined to the subject (strays.has_ring)
    symmetry: float = 0.0  # quality.symmetry, 0-1 (only measured when prefer_symmetry() is on)
    subjects: int = 1      # quality.separate_subjects: 2 or more is two things drawn (two cars) or one broken in two
    strays: float = 0.0    # share of its lines that were stray arcs or ground lines, erased (stray_lines.py)
    review: object = None  # Gemini's gemini.Review of it (live server, with GEMINI_API_KEY), or None


# With GHOSTLINES_PREFER_SYMMETRY=1, a draft's cost drops by up to this much for being mirror-symmetric
# (quality.symmetry), so of two near-equally clean drafts the even, balanced one wins: a basketball with matching
# seams over a lopsided one. Clean scores of usable drafts are about 10 to 60, so this decides close calls only.
SYMMETRY_BONUS = 15.0


def prefer_symmetry() -> bool:
    return os.environ.get("GHOSTLINES_PREFER_SYMMETRY") == "1"


def symmetry_bonus(c: Candidate) -> float:
    """How much a draft's mirror symmetry takes off its cost: nothing unless prefer_symmetry() is on."""
    return SYMMETRY_BONUS * c.symmetry if prefer_symmetry() else 0.0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Ghost Lines subject pack.")
    # A pack starts from either a text prompt (text to line art) or a photo (photo to line art).
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--prompt", help="text prompt for the line art, e.g. 'fox'")
    source.add_argument("--photo", help="path to a photo to turn into line art")
    parser.add_argument("--subject", required=True, help="subject id, e.g. 'fox'")
    parser.add_argument("--difficulty", required=True, choices=DIFFICULTIES)
    parser.add_argument("--seed", type=int, default=0, help="random seed, so a build can be repeated")
    parser.add_argument("--title", help="name shown in the app (default: the subject, capitalized)")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args.subject):
        parser.error("--subject must be lowercase letters, digits and dashes, e.g. 'fox' or 'coffee-mug'")
    return args


# ---------------------------------------------------------------- choosing a candidate


LOST_WEIGHT = 300  # choose: a draft that loses its whole drawing to simplifying would count 300 points less clean
RING_PENALTY = 150  # choose: a draft with a background ring around the subject counts this much less clean
SUBJECTS_PENALTY = 100  # choose: a draft with two separate subjects (two cars, a sneaker and a loose sole) likewise
STRAY_WEIGHT = 300  # choose: a draft whose lines were 10% stray arcs (erased) counts 30 points less clean
WRONG_PENALTY = 200  # choose: Gemini says the draft doesn't show the subject (a cat with three legs, a blob)
UNCLEAN_PENALTY = 100  # choose: Gemini says it has extra marks that aren't part of the subject (after the erasing)


def lost_share(strokes: list, limit: int) -> float:
    """Share of a drawing's line length that simplifying it to `limit` strokes would leave out (0 if it fits)."""
    if len(strokes) <= limit:
        return 0.0
    total = sum(stroke_length(s) for s in strokes)
    return 1 - sum(stroke_length(s) for s in simplify(strokes, limit)) / total if total else 0.0


def cost(candidate: Candidate, limit: int) -> float:
    """How much worse a draft would look as a lesson: its quality score (lower is cleaner), plus the lines simplifying
    it would remove (a draft just over the limit loses a few short lines and barely changes; one far over it loses
    much of the drawing), plus RING_PENALTY for a background ring around the subject (a fifth of live drafts had
    one, joined to the subject, and its arcs looked like stray lines), plus SUBJECTS_PENALTY for two separate subjects,
    minus the symmetry bonus when that is on. Both choosers use this, so the last check never undoes the first's pick
    (it used to leave the symmetry bonus out: a crossed, lopsided airplane beat a clean, symmetric one).
    Also STRAY_WEIGHT for the share of its lines that were stray arcs (they are erased, but a draft that had them is
    often messy in other ways too), and Gemini's review when there is one: WRONG_PENALTY if it doesn't show the
    subject, UNCLEAN_PENALTY if it still has extra marks."""
    review = candidate.review
    return (candidate.score + LOST_WEIGHT * lost_share(candidate.strokes, limit)
            + (RING_PENALTY if candidate.ringed else 0) + (SUBJECTS_PENALTY if candidate.subjects >= 2 else 0)
            + STRAY_WEIGHT * candidate.strays
            + (WRONG_PENALTY if review is not None and not review.shows_subject else 0)
            + (UNCLEAN_PENALTY if review is not None and not review.clean else 0)
            - symmetry_bonus(candidate))


def looks_good(candidate: Candidate) -> bool:
    """A draft good enough not to ask for more: Gemini found nothing wrong (when it looked), and no ring, two
    subjects, cut-off edge or much stray line was found here."""
    reviewed_ok = candidate.review is None or candidate.review.good
    return (reviewed_ok and not candidate.ringed and candidate.subjects < 2 and not candidate.cut_off
            and candidate.strays < STRAY_RETRY_SHARE)


STRAY_RETRY_SHARE = 0.05  # looks_good: a draft whose lines were more than 5% strays asks for new drafts


def choose(candidates: list[Candidate], min_strokes: int = MIN_STROKES, limit: int = MAX_STROKES,
           band_min: int = 0) -> int | None:
    """Index of the best candidate inside the stroke gate, or None. In order of preference: a whole subject (not
    cut off at the edge), then the lowest cost (the cleanest, counting what simplifying to `limit` would remove), then
    the fewest strokes. A draft with at least `band_min` strokes (enough lines for the difficulty asked for: a "medium"
    lesson needs more than a simple one's 25) comes before one with fewer. (Fitting the limit used to come before cleanliness, so a faint, sketchy cat with 48 strokes
    beat a crisp one with 54 for a 50-stroke lesson. Before that, fewest strokes first kept drawings with dashed or
    broken lines over cleaner ones.)"""
    usable = [
        i for i, c in enumerate(candidates)
        if min_strokes <= len(c.strokes) <= MAX_STROKES and c.score < REJECTED_SCORE
    ]
    if not usable:
        return None
    return min(usable, key=lambda i: (candidates[i].cut_off, len(candidates[i].strokes) < band_min,
                                      cost(candidates[i], limit), len(candidates[i].strokes)))


def choose_anyway(candidates: list[Candidate], min_strokes: int = MIN_STROKES, limit: int = MAX_STROKES,
                  band_min: int = 0) -> int | None:
    """When no candidate fits the gate: one that is clean and loses little when simplified (a 112-stroke house
    trimmed to 25 was unrecognizable), preferring a whole subject and one that isn't colored. So a clean giraffe with
    82 strokes beats a messy 73-stroke one. None if every candidate is blank. (A colored one is retraced in black.)"""
    usable = [i for i, c in enumerate(candidates) if len(c.strokes) >= min_strokes]
    if not usable:
        return None
    best = min((candidates[i].cut_off, candidates[i].score >= REJECTED_SCORE) for i in usable)
    group = [i for i in usable if (candidates[i].cut_off, candidates[i].score >= REJECTED_SCORE) == best]
    return min(group, key=lambda i: (len(candidates[i].strokes) < band_min, cost(candidates[i], limit),
                                     len(candidates[i].strokes)))


DETAIL_BOOST = 3.0  # simplify: a stroke inside a detail part (an eye, the nose, a door) counts as this much longer
WHOLE_PARTS = {"body", "wall"}  # parts that cover the whole subject (as pipeline.parts.WHOLE_OBJECT): no boost
OUTLINE_BOOST = 2.0  # simplify: a stroke along the subject's outer edge counts this much longer...
OUTLINE_SHARE = 0.6  # ...if at least this share of it lies within OUTLINE_NEAR_PX of that edge
OUTLINE_NEAR_PX = 8
OUTLINE_CLOSE_PX = 10  # gaps up to about twice this wide in the outline are bridged when finding the outer edge


def stroke_length(stroke) -> float:
    return sum(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 for (x1, y1), (x2, y2) in zip(stroke, stroke[1:]))


def outline_band(image: Image.Image):
    """True near the subject's outer edge (within OUTLINE_NEAR_PX): the edge of its silhouette, the ink with small
    gaps closed and every hole filled in. Used by simplify, so trimming a busy drawing never breaks its outline."""
    import numpy as np
    from scipy import ndimage

    ink = ink_mask(image)
    pad = OUTLINE_CLOSE_PX  # padding, so ink at the page's edge isn't closed against the border
    closed = ndimage.binary_closing(np.pad(ink, pad), iterations=OUTLINE_CLOSE_PX)[pad:-pad, pad:-pad]
    silhouette = ndimage.binary_fill_holes(closed)
    edge = silhouette & ~ndimage.binary_erosion(silhouette)
    return ndimage.distance_transform_edt(~edge) <= OUTLINE_NEAR_PX


FEATURE_MAX_PX = 80      # feature_boxes: a solid blob of ink at most this wide and tall (an eye, a nose)...
FEATURE_MIN_PX = 8       # ...at least this wide and tall...
FEATURE_SOLIDITY = 0.35  # ...filling at least this share of its bounding box (a thin tick of fur fills far less)
FEATURE_ASPECT = 2.5     # ...and at most this many times longer than wide


def feature_boxes(image: Image.Image) -> list[list[int]]:
    """Boxes ([x, y, w, h]) around small, solid, roundish blobs of ink: eyes, a nose, nostrils, buttons. An eye drawn
    as a black dot with a white highlight traces into a few short, open strokes, which trimming by length dropped
    (a cat lost one eye, a fish its only one) whenever OWLv2 hadn't found an eye there."""
    import numpy as np
    from scipy import ndimage

    labels, _ = ndimage.label(ink_mask(image), structure=np.ones((3, 3), dtype=int))
    boxes = []
    for label, box in enumerate(ndimage.find_objects(labels), start=1):
        if box is None:
            continue
        h, w = box[0].stop - box[0].start, box[1].stop - box[1].start
        if not FEATURE_MIN_PX <= min(h, w) <= max(h, w) <= FEATURE_MAX_PX or max(h, w) > FEATURE_ASPECT * min(h, w):
            continue
        if (labels[box] == label).sum() >= FEATURE_SOLIDITY * h * w:
            boxes.append([box[1].start - 4, box[0].start - 4, w + 8, h + 8])
    return boxes


def small_shape(stroke) -> bool:
    """True for a closed stroke enclosing at most SMALL_SHAPE_PX: a dot or a ring for an eye, a nostril, a button."""
    points = [tuple(p) for p in stroke]
    closed = len(points) >= 3 and abs(points[0][0] - points[-1][0]) + abs(points[0][1] - points[-1][1]) <= 4
    return closed and _polygon_area(points) <= SMALL_SHAPE_PX


UNIT_MAX_STROKES = 8  # simplify: a separate small group of at most this many strokes is kept or dropped whole


def stroke_groups(image: Image.Image, strokes: list) -> list[int]:
    """For each stroke, the piece of ink (as the tracer sees it) it runs along: strokes sharing one are drawn joined
    up, like the four sides of a window. A stroke off the ink (an eye drawn as a gray almond) is a group of its own."""
    import numpy as np
    from scipy import ndimage

    labels, count = ndimage.label(ink_mask(image), structure=np.ones((3, 3), dtype=int))
    groups = []
    for k, stroke in enumerate(strokes):
        hits = [labels[min(max(int(y), 0), SIZE - 1), min(max(int(x), 0), SIZE - 1)] for x, y in points_along(stroke)]
        hits = [h for h in hits if h]
        groups.append(max(set(hits), key=hits.count) if hits else count + 1 + k)
    return groups


def simplify(strokes: list, limit: int = MAX_STROKES, detail_boxes: list = (), outline=None, groups=None) -> list:
    """The `limit` most important strokes, in their original order. Importance is length, except that a stroke
    centered inside a detail part (detail_boxes, each [x, y, w, h]: the head, an eye, a door) counts DETAIL_BOOST
    times its length, and so does a small closed shape (a dot or ring eye, a nostril: features, wherever OWLv2 found
    parts); one running along the subject's outer edge (`outline`, from outline_band) counts OUTLINE_BOOST times. So
    a busy drawing keeps its outline whole, its big lines and its features, and loses texture and stray bits. (By
    length alone, a cat lost its nose and mouth, a house its porch windows, a fish its eye, and outlines got gaps.)

    With `groups` (from stroke_groups), a separate small group of strokes (a window, an eye, a bush: at most
    UNIT_MAX_STROKES) is kept or dropped whole, never cut in half: half a window looked broken. The groups and the
    strokes of big groups are taken in order of importance per stroke they use, while they fit."""
    def on_outline(stroke) -> bool:
        if outline is None:
            return False
        points = points_along(stroke)
        near = sum(bool(outline[min(max(int(y), 0), SIZE - 1), min(max(int(x), 0), SIZE - 1)]) for x, y in points)
        return near >= OUTLINE_SHARE * len(points)

    def importance(stroke) -> float:
        cx, cy = sum(p[0] for p in stroke) / len(stroke), sum(p[1] for p in stroke) / len(stroke)
        detail = any(x <= cx <= x + w and y <= cy <= y + h for x, y, w, h in detail_boxes) or small_shape(stroke)
        boost = max(DETAIL_BOOST if detail else 1.0, OUTLINE_BOOST if on_outline(stroke) else 1.0)
        return stroke_length(stroke) * boost

    if len(strokes) <= limit:
        return list(strokes)
    if groups is None:
        groups = list(range(len(strokes)))  # every stroke on its own
    members: dict[int, list[int]] = {}
    for i, group in enumerate(groups):
        members.setdefault(group, []).append(i)
    # Items to choose from: a small group as a whole, or one stroke of a big group.
    items = []
    for indices in members.values():
        if len(indices) <= UNIT_MAX_STROKES:
            items.append(indices)
        else:
            items += [[i] for i in indices]
    value = {i: importance(s) for i, s in enumerate(strokes)}
    items.sort(key=lambda item: sum(value[i] for i in item) / len(item), reverse=True)
    keep: set[int] = set()
    for item in items:
        if len(keep) + len(item) <= limit:
            keep.update(item)
    return [s for i, s in enumerate(strokes) if i in keep]


def rate_difficulty(n_strokes: int) -> str:
    """How hard a drawing really is, from how many strokes the user has to draw (the lines in the reference).
    Up to 25 is simple, up to 50 medium, more detailed. The live server labels its packs with this rather than the
    difficulty the user asked for, because the AI can draw a busy subject (an F1 car) however it was asked."""
    if n_strokes <= SIMPLE_MAX_STROKES:
        return "simple"
    return "medium" if n_strokes <= MEDIUM_MAX_STROKES else "detailed"


# ---------------------------------------------------------------- images


KEEP_NEAR_PX = 3     # without_strokes: drawn pixels this close to a kept stroke stay (where a dropped line meets it)
LINE_REACH_PX = 12   # ...and a dropped stroke's line reaches this far from its center line (thick lines, soft edges)
BRIDGE_PX = 40       # a dropped stroke at most this long with both ends on kept lines stays drawn (a knee, a corner)
FAINT_LEVEL = 12     # anything this much darker than the page counts as drawn (the faint edges of a line included)


def _lines(strokes: list):
    """The strokes drawn as 1-px lines on a 768 x 768 boolean canvas."""
    import numpy as np

    canvas = Image.new("1", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(canvas)
    for stroke in strokes:
        draw.line([tuple(p) for p in stroke], fill=1, width=1)
    return np.asarray(canvas, dtype=bool)


def still_drawn(kept: list, dropped: list, protect: list = ()) -> list:
    """The dropped strokes that stay on a simplified lesson's reference: a short one joining two kept lines (a knee,
    the corner of a window), or the outline would show a gap, and one centered in a `protect` box ([x, y, w, h]: the
    head, an eye), so a face never gets a blank patch."""
    from scipy import ndimage

    to_kept = ndimage.distance_transform_edt(~_lines(kept))

    def on_kept(point) -> bool:
        x, y = min(max(int(point[0]), 0), SIZE - 1), min(max(int(point[1]), 0), SIZE - 1)
        return to_kept[y, x] <= KEEP_NEAR_PX + 3

    def bridge(stroke) -> bool:
        return stroke_length(stroke) <= BRIDGE_PX and on_kept(stroke[0]) and on_kept(stroke[-1])

    def protected(stroke) -> bool:
        cx, cy = sum(p[0] for p in stroke) / len(stroke), sum(p[1] for p in stroke) / len(stroke)
        return any(x <= cx <= x + w and y <= cy <= y + h for x, y, w, h in protect)

    return [s for s in dropped if bridge(s) or protected(s)]


def without_strokes(image: Image.Image, kept: list, dropped: list, protect: list = ()) -> Image.Image:
    """The AI drawing with the dropped strokes' lines painted over in the page's color, for a lesson that keeps only
    some of the drawing's strokes. The reference then shows exactly what the lesson teaches, still drawn the way the
    AI drew it. (Re-drawing the kept strokes themselves looked broken and sketchy: uniform lines with gaps wherever
    a short piece had been dropped.) Each drawn pixel belongs to the nearest stroke's line. Dropped strokes that
    still_drawn() keeps (bridges, and strokes inside a `protect` box) stay."""
    import numpy as np
    from scipy import ndimage

    to_kept = ndimage.distance_transform_edt(~_lines(kept))
    staying = {id(s) for s in still_drawn(kept, dropped, protect)}
    to_dropped = ndimage.distance_transform_edt(~_lines([s for s in dropped if id(s) not in staying]))
    rgb = image.convert("RGB").resize((SIZE, SIZE))
    pixels = np.asarray(rgb).copy()
    gray = np.asarray(rgb.convert("L"))
    drawn = gray < np.median(gray) - FAINT_LEVEL  # the page is most of the picture
    erase = drawn & (to_dropped < to_kept) & (to_kept > KEEP_NEAR_PX) & (to_dropped <= LINE_REACH_PX)
    pixels[erase] = np.median(pixels[~drawn], axis=0).astype(np.uint8) if (~drawn).any() else 255
    return Image.fromarray(pixels, "RGB")


EDGE_PX = 3              # lesson_only: the soft (anti-aliased) edge kept around the ink of a shown stroke
SMALL_SHAPE_PX = 6000    # ...and everything inside a closed shown stroke enclosing at most this area (in px) stays


def _polygon_area(stroke) -> float:
    """Area enclosed by a stroke read as a polygon (the shoelace formula)."""
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(stroke, stroke[1:] + stroke[:1]))) / 2


def lesson_only(image: Image.Image, shown: list) -> Image.Image:
    """The drawing with everything the lesson doesn't show painted over in the page's color, so the reference holds
    exactly the lines the user is taught. What stays: each piece of ink (as the tracer sees it) that a shown stroke
    runs along, whole (so solid fills and thick lines stay as drawn), with its soft edge; and everything inside a
    small closed shown stroke (a dot eye, an eye drawn as a gray almond, which is lighter than ink). What goes: faint
    gray sketch lines the tracer never counted as ink (they made sketchy, unfinished-looking "stray lines" on the
    reference), and scraps too small to become strokes."""
    import numpy as np
    from scipy import ndimage

    if not shown:
        return image
    rgb = image.convert("RGB").resize((SIZE, SIZE))
    ink = ink_mask(rgb)
    labels, _ = ndimage.label(ink, structure=np.ones((3, 3), dtype=int))
    hit = np.unique(labels[_lines(shown)])
    keep = np.isin(labels, hit[hit > 0])
    shapes = Image.new("1", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(shapes)
    for stroke in shown:
        if small_shape(stroke):
            draw.polygon([tuple(p) for p in stroke], fill=1, outline=1)
    keep = ndimage.binary_dilation(keep | np.asarray(shapes, dtype=bool), iterations=EDGE_PX)
    pixels = np.asarray(rgb).copy()
    gray = np.asarray(rgb.convert("L"))
    drawn = gray < np.median(gray) - FAINT_LEVEL
    erase = drawn & ~keep
    if not erase.any():
        return image
    pixels[erase] = np.median(pixels[~drawn], axis=0).astype(np.uint8) if (~drawn).any() else 255
    return Image.fromarray(pixels, "RGB")


FILL_FADE = (120, 165)  # clean_drawing: gray levels from the first fade to white at the second (fills, halos, shading)


def clean_drawing(image: Image.Image) -> Image.Image:
    """The drawing the user copies: the chosen AI drawing itself, cleaned up (gray or uneven page to white, ink to
    crisp black, colour removed). It keeps the drawing's line weight and small details, which re-drawing it from
    the traced strokes lost. The traced strokes come from this same image, so the lesson's guides and the
    measurements still line up with it. Gray fills, shading and the halo of a gray disc behind the subject fade to
    white (FILL_FADE): the lesson only teaches lines dark enough to be ink (the tracer's threshold is at most 100),
    so the reference shows just those, as crisp black lines on white."""
    import numpy as np
    from scipy import ndimage

    gray = np.asarray(image.convert("L"), dtype=np.float32)
    # The page's brightness around each pixel: the lightest value nearby, smoothed (pages are often unevenly lit).
    page = ndimage.uniform_filter(ndimage.maximum_filter(gray, size=31), size=31)
    ratio = gray / np.maximum(page, 1.0)  # 1 = page, lower = ink
    # The ink's level: the darkest 2% of pixels, but at most half the page's brightness, so a drawing with very
    # little ink (under 2% of the image) doesn't mistake the page for ink.
    ink = min(float(np.percentile(ratio, 2)), 0.5)
    white_from = 1.0 - 0.18 * (1.0 - ink)  # this close to the page counts as page
    out = np.clip((ratio - ink) / max(white_from - ink, 1e-3), 0.0, 1.0) ** 1.6
    out = np.maximum(out, np.clip((gray - FILL_FADE[0]) / (FILL_FADE[1] - FILL_FADE[0]), 0.0, 1.0))
    return Image.fromarray((out * 255).astype(np.uint8), "L").resize((SIZE, SIZE), Image.LANCZOS)


def skeleton_image(image: Image.Image) -> Image.Image:
    skeleton = skeleton_of(ink_mask(image))
    return Image.fromarray(((~skeleton) * 255).astype("uint8"))


def parts_image(image: Image.Image, parts: list[dict]) -> Image.Image:
    base = image.convert("RGB").copy()
    draw = ImageDraw.Draw(base)
    for part in parts:
        x, y, w, h = part["box"]
        draw.rectangle((x, y, x + w, y + h), outline=(59, 108, 255), width=3)
        draw.text((x + 5, y + 3), part["label"], fill=(59, 108, 255))
    return base


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def webp_bytes(image: Image.Image) -> bytes:
    """The image as webp, at the best quality that fits in MAX_IMAGE_BYTES."""
    for quality in (85, 75, 60, 45, 30):
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, "WEBP", quality=quality)
        if buffer.tell() <= MAX_IMAGE_BYTES:
            return buffer.getvalue()
    raise ValueError("could not fit an image in 300 KB")


# ---------------------------------------------------------------- the pack


def drafts_text(n: int) -> str:
    """Who drew the drafts, for the "How this lesson was made" panel."""
    if openai_images.enabled():
        return openai_images.drafts_text(n)
    if image_model() == "flux":
        return f"FLUX.1-schnell drew {n} line-art drafts."
    return f"SDXL-Lightning drew {n} line-art drafts, {lightning_steps()} steps each."


def pipeline_stages(
    source_kind: str, prompt_text: str, chosen: int, n_strokes: int, parts: list[dict], plan: dict,
    n_candidates: int = N_CANDIDATES, source_note: str | None = None, review_note: str | None = None,
) -> list[dict]:
    """The "How this lesson was made" stages, in the order the contract requires. `source_note` replaces the
    photo stage's first sentence (the live server: the photo was named, not traced). `review_note` is added to the
    drafts stage (what Gemini's review and the stray-line check did)."""
    candidate_paths = [f"pipeline/candidate-{i}.webp" for i in range(n_candidates)]
    if source_kind == "photo":
        note = source_note or "The photo's lines guided the drawing."
        source = {"id": "source", "label": "Photo", "image": "pipeline/source.webp",
                  "text": f"{note} Prompt: {prompt_text}"}
    else:
        source = {"id": "source", "label": "Prompt", "text": prompt_text}
    part_names = ", ".join(p["label"].lower() for p in parts)
    return [
        source,
        {"id": "candidates", "label": f"{n_candidates} AI drafts", "images": candidate_paths,
         "text": " ".join(filter(None, [drafts_text(n_candidates), review_note]))},
        {"id": "chosen", "label": "Chosen drawing", "image": candidate_paths[chosen],
         "text": f"The cleanest draft, traced into {n_strokes} strokes (a lesson keeps {MIN_STROKES}-{MAX_STROKES})."},
        {"id": "skeleton", "label": "Traced lines", "image": "pipeline/skeleton.webp",
         "text": f"Thinned to 1 px lines, then traced into {n_strokes} strokes."},
        {"id": "parts", "label": "Parts found", "image": "pipeline/parts.webp",
         "text": f"OWLv2 found: {part_names}." if parts else "No parts were found, so the lesson has none."},
        {"id": "order", "label": "Your lesson",
         "text": f"{len(plan['strokes'])} strokes in {len(plan['steps'])} steps: big shapes first, "
                 "then outlines, inner lines and details."},
    ]


def assemble_pack(
    pack_id: str, subject: str, title: str, difficulty: str, source_kind: str, prompt: str | None,
    prompt_text: str, chosen: int, n_strokes: int, parts: list[dict], plan: dict, n_candidates: int = N_CANDIDATES,
    source_note: str | None = None, review_note: str | None = None,
) -> dict:
    """pack.json as a dict, checked against the schema (raises if it doesn't match types.ts)."""
    pack = {
        "id": pack_id,
        "subject": subject,
        "title": title,
        "difficulty": difficulty,
        "size": SIZE,
        "source": {"kind": source_kind, **({"prompt": prompt} if prompt else {})},
        "target": "target.png",
        "thumb": "thumb.png",
        "parts": parts,
        "strokes": plan["strokes"],
        "steps": plan["steps"],
        "pipeline": pipeline_stages(source_kind, prompt_text, chosen, n_strokes, parts, plan, n_candidates,
                                    source_note, review_note),
    }
    schema.Pack.model_validate(pack)
    return pack


def update_index(index_path: Path, subject: str, title: str, difficulty: str, pack_id: str) -> dict:
    """Adds this pack to index.json, keeping every other subject and difficulty. There is one entry per
    subject (the app keys its subject cards by it), and a hand-made demo pack ("demo-...") gives way to the
    real one. The subject's thumbnail is its medium pack's, if it has one."""
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"subjects": []}
    entry = next((e for e in index["subjects"] if e["subject"] == subject), None)
    if entry is None:
        entry = {"subject": subject, "title": title, "thumb": f"{pack_id}/thumb.png", "packs": {}}
        index["subjects"].append(entry)
    entry["packs"] = {d: pid for d, pid in entry["packs"].items() if not pid.startswith("demo-")}
    entry["title"] = title
    entry["packs"][difficulty] = pack_id
    entry["thumb"] = f"{entry['packs'].get('medium', pack_id)}/thumb.png"
    schema.SubjectIndex.model_validate(index)
    return index


# ---------------------------------------------------------------- the build


def review_note(candidates: list[Candidate], asked_again: bool) -> str | None:
    """What the checks did, for the drafts stage of the "How this lesson was made" panel. Only facts we measured."""
    notes = []
    erased = sum(1 for c in candidates if c.strays > 0)
    if erased:
        notes.append(f"Stray arcs or ground lines were erased from {erased} of them.")
    reviewed = [c.review for c in candidates if c.review is not None]
    if reviewed:
        notes.append(f"Gemini checked each draft: {sum(r.good for r in reviewed)} of {len(reviewed)} looked good.")
    if asked_again:
        notes.append("None was good enough at first, so the AI was asked to draw again.")
    return " ".join(notes) or None


def make_pack(
    *, pack_id: str, subject: str, title: str, difficulty: str, source_kind: str, prompt: str | None,
    subject_words: str, seed: int, generate, detect, retries: int = 1, photo: Image.Image | None = None, log=print,
    always: bool = False, check_drawing=None, rate: bool = False, limit: int = MAX_STROKES,
    min_strokes: int = MIN_STROKES, source_note: str | None = None, review=None, regenerate=None,
    finish_by: float | None = None, band_min: int = 0, more_detail=None,
) -> tuple[dict, dict[str, bytes]]:
    """Builds a pack in memory: (pack.json dict, {asset path: file bytes}). Used by build() to write files and
    by the live server (api.py) to return images as data: URLs. Raises NoCleanCandidate if nothing fits, unless
    `always` (the live server): then the cleanest drawing is used and simplified to the stroke limit.
    `check_drawing(image)`, if given, may raise to refuse the chosen drawing (the live server's safety check).
    With `rate` (the live server), the pack's difficulty is rate_difficulty() of the chosen drawing, not `difficulty`
    (which still goes into the prompt). Offline packs keep the difficulty they were built for.
    `limit` (the live server: fewer for simple, more for detailed) is the most strokes a lesson keeps. A drawing
    with more is simplified to its longest strokes, and the other strokes' lines are painted out of its reference, so
    what the user copies is what the lesson teaches (and a "simple" lesson really is simple).

    `min_strokes` raises the gate's lower end (a drawing of a few scattered fragments is not a drawing of the
    subject). Every draft first has any frame drawn around the picture removed (pipeline/frame.py), then any stray
    marks around the subject (pipeline/strays.py), and is then scaled up to fill the page (frame.fit_to_page).
    `source_note` says how a photo became the subject, in the "How this lesson was made" panel.

    generate(seed) returns candidate drawings (seeds seed, seed + 1, ...); detect(image) returns parts.

    Every draft is also checked for long stray lines joined to the subject (a big arc over a car, a ring's arc
    touching an ear: pipeline/stray_lines.py); they are erased and the draft retraced. `review(images)` (the live
    server, with Gemini) returns a gemini.Review per draft, or None; the answers count when choosing (cost). When no
    draft looks_good and there is time to make another round before `finish_by` (a time.monotonic() value; the
    round is assumed to take as long as the first), `regenerate(seed)` (or generate) is asked for new drafts once,
    and the best of all of them is used.

    `band_min` (the live server) is the fewest strokes the difficulty asked for needs (rate_difficulty: a "medium"
    lesson has more than 25). Drafts with that many are preferred, and when every draft has fewer and there is time,
    `more_detail(seed)` is asked for new drafts once (Oct 14: a "medium" request often came back as a simple drawing)."""
    started = time.monotonic()
    prompt_text = (openai_prompt(subject_words, difficulty) if openai_images.enabled()  # the prompt actually sent
                   else line_art_prompt(subject_words, variant=active_variant(), difficulty=difficulty))
    def make_candidates(images, first_seed: int, numbered_from: int = 0) -> list[Candidate]:
        made = []
        for i, image in enumerate(images):
            image = remove_strays(remove_frame(image))
            cut_off = is_cut_off(image)  # before fitting, which puts space around everything
            image = fit_to_page(image)
            strokes = trace(image)
            strays = find_strays(image, strokes)
            stray = stray_share(strokes, strays)
            if strays:  # erase the stray arcs and ground lines, fit what is left to the page again, and trace it
                kept, dropped = split_off(strokes, strays)
                image = fit_to_page(without_strokes(image, kept, dropped))
                strokes = trace(image)
            sym = symmetry(image) if prefer_symmetry() else 0.0
            made.append(Candidate(image, strokes, line_metrics(image)["score"], cut_off, has_ring(strokes),
                                  symmetry=sym, subjects=separate_subjects(image), strays=stray))
            log(f"  candidate {numbered_from + i} (seed {first_seed + i}): {len(strokes)} strokes, "
                f"score {made[-1].score:.1f}"
                + (f", {stray:.0%} of its lines were stray arcs (erased)" if strays else "")
                + (", cut off at the edge" if made[-1].cut_off else "")
                + (", ring around the subject" if made[-1].ringed else "")
                + (", two separate subjects" if made[-1].subjects >= 2 else ""))
        if review is not None and made:
            reviews = review([c.image for c in made])
            if reviews is None:
                log("  gemini: no review (busy or offline); judging by the local checks only")
            for k, (c, r) in enumerate(zip(made, reviews or [])):
                c.review = r
                log(f"  gemini on candidate {numbered_from + k}: "
                    + ("good" if r.good else "; ".join(r.problems) or ("not the subject" if not r.shows_subject
                                                                       else "not clean")))
        return made

    tries = []
    for attempt in range(retries + 1):
        first_seed = seed + attempt * RETRY_SEED_OFFSET
        candidates = make_candidates(generate(first_seed), first_seed)
        tries.append(candidates)
        chosen = choose(candidates, min_strokes, limit, band_min)
        if chosen is not None:
            break
    else:
        chosen = choose_anyway(candidates, min_strokes, limit, band_min) if always else None
        if chosen is not None:
            log(f"  no candidate fit {min_strokes}-{MAX_STROKES} strokes: using candidate {chosen}, simplified")
    asked_again = False
    round_s = time.monotonic() - started
    if (finish_by is not None and candidates and not any(looks_good(c) for c in candidates)
            and time.monotonic() + round_s <= finish_by):
        # No draft is good (Gemini or the local checks found a problem with each): ask the image model again, once,
        # and choose from all of them. Only when the new round should end before finish_by.
        log("  no draft looks good: asking the image model for new ones")
        first_seed = seed + REVIEW_SEED_OFFSET
        candidates = candidates + make_candidates((regenerate or generate)(first_seed), first_seed, len(candidates))
        asked_again = True
        chosen = choose(candidates, min_strokes, limit, band_min)
        if chosen is None and always:
            chosen = choose_anyway(candidates, min_strokes, limit, band_min)
    if (more_detail is not None and finish_by is not None and candidates and band_min
            and all(len(c.strokes) < band_min for c in candidates)
            and time.monotonic() + round_s <= finish_by):
        # Every draft is simpler than the difficulty asked for: ask once more, for more detail, and choose from all.
        log(f"  every draft has under {band_min} strokes (too simple for {difficulty}): asking for more detail")
        first_seed = seed + DETAIL_SEED_OFFSET
        candidates = candidates + make_candidates(more_detail(first_seed), first_seed, len(candidates))
        chosen = choose(candidates, min_strokes, limit, band_min)
        if chosen is None and always:
            chosen = choose_anyway(candidates, min_strokes, limit, band_min)
    if always and chosen is not None and candidates[chosen].cut_off:
        # The only drafts inside the gate are cut off at the edge (a giraffe's neck, cropped): a whole subject is
        # better even if it has too many strokes and gets simplified.
        uncut = [c if not c.cut_off else Candidate(c.image, [], c.score) for c in candidates]  # cut ones can't win
        whole = choose_anyway(uncut, min_strokes, limit, band_min)
        if whole is not None:
            chosen = whole
            log(f"  candidate {chosen} is a whole subject: using it instead of a cut-off one, simplified")
    if always and chosen is not None:
        # The live server simplifies any draft to the limit, so the 60-stroke gate only says which drafts fit as
        # drawn: a cleaner draft just over it, or one without a ring around the subject, makes the better lesson.
        overall = choose_anyway(candidates, min_strokes, limit, band_min)
        if overall is not None and overall != chosen:
            chosen = overall
            log(f"  candidate {chosen} is cleaner, counting what simplifying removes: using it, simplified")
    if chosen is None:
        counts = "; ".join(", ".join(str(len(c.strokes)) for c in t) for t in tries)
        raise NoCleanCandidate(
            f"No candidate had {min_strokes}-{MAX_STROKES} strokes and a clean score (stroke counts: {counts}). "
            "Try another --seed or a simpler --prompt."
        )

    if candidates[chosen].subjects >= 2:
        # Every draft drew several subjects (else the penalty would have picked a single one): teach the biggest.
        alone = biggest_subject(candidates[chosen].image)
        if alone is not None:
            alone = fit_to_page(alone)
            strokes = trace(alone)
            if len(strokes) >= min_strokes:
                c = candidates[chosen]
                candidates[chosen] = Candidate(alone, strokes, line_metrics(alone)["score"], c.cut_off,
                                               has_ring(strokes), c.symmetry, separate_subjects(alone), c.strays,
                                               c.review)
                log(f"  candidate {chosen} drew {c.subjects} separate subjects: keeping only the biggest "
                    f"({len(strokes)} strokes)")

    best = candidates[chosen]
    n_traced = len(best.strokes)
    if check_drawing is not None:
        check_drawing(best.image)
    parts = detect(best.image)
    details = [p["box"] for p in parts if p["id"].split("_")[0] not in WHOLE_PARTS]  # the head, eyes, a door...
    details += feature_boxes(best.image)  # eyes and noses OWLv2 didn't box
    simplified = len(best.strokes) > limit
    dropped = []  # the strokes a simplified lesson leaves out
    if simplified:
        groups = stroke_groups(best.image, best.strokes)
        kept = simplify(best.strokes, limit, details, outline_band(best.image), groups)
        kept_ids = {id(stroke) for stroke in kept}
        dropped = [stroke for stroke in best.strokes if id(stroke) not in kept_ids]
        best = Candidate(best.image, kept, best.score, best.cut_off)
    if rate:
        difficulty = rate_difficulty(len(best.strokes))  # what the user will draw (the reference shows just these)
    plan = build_plan(best.strokes, parts, subject=subject)
    pack = assemble_pack(pack_id, subject, title, difficulty, source_kind, prompt, prompt_text, chosen,
                         n_traced, parts, plan, n_candidates=len(candidates), source_note=source_note,
                         review_note=review_note(candidates, asked_again))
    # The reference: the AI drawing without the strokes a simplified lesson leaves out, and without anything else the
    # lesson doesn't show (faint sketch lines, scraps too small to trace), cleaned to crisp black on white.
    if simplified:
        drawing = without_strokes(best.image, best.strokes, dropped, details)
        shown = best.strokes + still_drawn(best.strokes, dropped, details)
    else:
        drawing, shown = best.image, best.strokes
    target = clean_drawing(lesson_only(drawing, shown))
    assets = {
        "target.png": png_bytes(target),
        "thumb.png": png_bytes(target.resize((256, 256), Image.LANCZOS)),
        **{f"pipeline/candidate-{i}.webp": webp_bytes(c.image) for i, c in enumerate(candidates)},
        "pipeline/skeleton.webp": webp_bytes(skeleton_image(best.image)),
        "pipeline/parts.webp": webp_bytes(parts_image(best.image, parts)),
    }
    if photo is not None:
        from pipeline.generate import pad_to_square

        upright = ImageOps.exif_transpose(photo).convert("RGB")  # phone photos the right way up
        assets["pipeline/source.webp"] = webp_bytes(pad_to_square(upright, (255, 255, 255)).resize((SIZE, SIZE)))
    return pack, assets


def build(args: argparse.Namespace, generate=None, detect=None, subjects_dir: Path = SUBJECTS_DIR) -> Path:
    """Builds and writes one pack; returns its folder. `generate(seed)` and `detect(image)` can be swapped
    for fakes in tests; by default they use the GPU models."""
    pack_id = f"{args.subject}-{args.difficulty}"
    title = args.title or args.subject.replace("-", " ").capitalize()
    subject_words = args.prompt if args.prompt else args.subject.replace("-", " ")
    photo = Image.open(args.photo) if args.photo else None

    if generate is None:
        from pipeline import generate as gen

        if photo is not None:
            def generate(seed):
                return gen.from_photo(photo, subject_words, args.difficulty, n=N_CANDIDATES, seed=seed)
        else:
            def generate(seed):
                return gen.from_prompt(subject_words, args.difficulty, n=N_CANDIDATES, seed=seed)
    if detect is None:
        from pipeline.parts import detect_parts

        def detect(image):
            # Parts are named after the subject id, not the prompt, so a reworded prompt ("a simple house")
            # still looks for the house's parts (roof, door, ...).
            return detect_parts(image, args.subject.replace("-", " "), pack_id)

    try:
        # Everything is built and checked against the schema before anything is written.
        pack, assets = make_pack(
            pack_id=pack_id, subject=args.subject, title=title, difficulty=args.difficulty,
            source_kind="photo" if photo is not None else "prompt", prompt=args.prompt,
            subject_words=subject_words, seed=args.seed, generate=generate, detect=detect, photo=photo,
        )
    except NoCleanCandidate as error:
        raise SystemExit(str(error)) from None
    index_path = subjects_dir / "index.json"
    index = update_index(index_path, args.subject, title, args.difficulty, pack_id)

    # Write: a fresh folder each time, so no stale images are left behind.
    folder = subjects_dir / pack_id
    if folder.exists():
        shutil.rmtree(folder)
    (folder / "pipeline").mkdir(parents=True)
    for name, data in assets.items():
        (folder / name).write_bytes(data)
    (folder / "pack.json").write_text(json.dumps(pack, indent=1) + "\n", encoding="utf-8")
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return folder


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    from pipeline import models

    models.setup_hf_env()
    folder = build(args)
    pack = json.loads((folder / "pack.json").read_text(encoding="utf-8"))
    size_kb = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) / 1024
    print(f"\nBuilt {pack['id']}: {len(pack['strokes'])} strokes, {len(pack['steps'])} steps, "
          f"{len(pack['parts'])} parts ({', '.join(p['id'] for p in pack['parts']) or 'none'}), {size_kb:.0f} KB")
    print(f"Inspector: http://localhost:5173/Bananahacks-/?debug=pack&id={pack['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
