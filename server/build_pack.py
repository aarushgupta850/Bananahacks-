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
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline import schema  # noqa: E402
from pipeline.order import build_plan  # noqa: E402
from pipeline.prompts import line_art_prompt  # noqa: E402
from pipeline.quality import line_metrics  # noqa: E402
from pipeline.frame import fit_to_page, remove_frame  # noqa: E402
from pipeline.strays import is_cut_off, remove_strays  # noqa: E402
from pipeline.trace import ink_mask, skeleton_of, trace  # noqa: E402

SUBJECTS_DIR = SERVER_DIR.parent / "web" / "public" / "subjects"
DIFFICULTIES = ["simple", "medium", "detailed"]  # must match Difficulty in web/src/engine/types.ts
N_CANDIDATES = 4
RETRY_SEED_OFFSET = 100  # the retry uses seeds this far from the first try's
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


def choose(candidates: list[Candidate], min_strokes: int = MIN_STROKES, limit: int = MAX_STROKES) -> int | None:
    """Index of the best candidate inside the stroke gate, or None. In order of preference: a whole subject (not
    cut off at the edge), then one that fits `limit` as drawn (a drawing over the limit loses its smallest lines,
    so it looks unfinished), then the cleanest (lowest quality score), then the fewest strokes. (Fewest strokes
    first, as before, kept drawings with dashed or broken lines over cleaner ones.)"""
    usable = [
        i for i, c in enumerate(candidates)
        if min_strokes <= len(c.strokes) <= MAX_STROKES and c.score < REJECTED_SCORE
    ]
    if not usable:
        return None
    return min(usable, key=lambda i: (candidates[i].cut_off, len(candidates[i].strokes) > limit,
                                      candidates[i].score, len(candidates[i].strokes)))


def choose_anyway(candidates: list[Candidate], min_strokes: int = MIN_STROKES) -> int | None:
    """When no candidate fits the gate: the one with enough lines that loses the fewest when simplified (the
    fewest strokes: a 112-stroke house trimmed to 25 was unrecognizable), preferring a whole subject and a drawing
    that isn't colored; or None if every candidate is blank. (A colored one gets retraced in black anyway.)"""
    usable = [i for i, c in enumerate(candidates) if len(c.strokes) >= min_strokes]
    return min(usable, key=lambda i: (candidates[i].cut_off, candidates[i].score >= REJECTED_SCORE,
                                      len(candidates[i].strokes))) if usable else None


DETAIL_BOOST = 3.0  # simplify: a stroke inside a detail part (an eye, the nose, a door) counts as this much longer
WHOLE_PARTS = {"body", "wall"}  # parts that cover the whole subject (as pipeline.parts.WHOLE_OBJECT): no boost


def simplify(strokes: list, limit: int = MAX_STROKES, detail_boxes: list = ()) -> list:
    """The `limit` most important strokes, in their original order. Importance is length, except that a stroke
    centered inside a detail part (detail_boxes, each [x, y, w, h]: the head, an eye, a door) counts DETAIL_BOOST
    times its length. So a busy drawing keeps its big lines and its features, and loses texture and stray bits.
    (By length alone, a cat lost its nose and mouth, and a house its porch windows.)"""
    def length(stroke) -> float:
        return sum(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 for (x1, y1), (x2, y2) in zip(stroke, stroke[1:]))

    def importance(stroke) -> float:
        cx, cy = sum(p[0] for p in stroke) / len(stroke), sum(p[1] for p in stroke) / len(stroke)
        detail = any(x <= cx <= x + w and y <= cy <= y + h for x, y, w, h in detail_boxes)
        return length(stroke) * (DETAIL_BOOST if detail else 1.0)

    keep = set(sorted(range(len(strokes)), key=lambda i: importance(strokes[i]), reverse=True)[:limit])
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


def without_strokes(image: Image.Image, kept: list, dropped: list) -> Image.Image:
    """The AI drawing with the dropped strokes' lines painted over in the page's color, for a lesson that keeps only
    some of the drawing's strokes. The reference then shows exactly what the lesson teaches, still drawn the way the
    AI drew it. (Re-drawing the kept strokes themselves looked broken and sketchy: uniform lines with gaps wherever
    a short piece had been dropped.) Each drawn pixel belongs to the nearest stroke's line. A short dropped stroke
    joining two kept lines (a knee, the corner of a window) stays drawn, or the outline would show a gap."""
    import math

    import numpy as np
    from scipy import ndimage

    def lines(strokes: list) -> np.ndarray:
        canvas = Image.new("1", (SIZE, SIZE), 0)
        draw = ImageDraw.Draw(canvas)
        for stroke in strokes:
            draw.line([tuple(p) for p in stroke], fill=1, width=1)
        return np.asarray(canvas, dtype=bool)

    to_kept = ndimage.distance_transform_edt(~lines(kept))

    def on_kept(point) -> bool:
        x, y = min(max(int(point[0]), 0), SIZE - 1), min(max(int(point[1]), 0), SIZE - 1)
        return to_kept[y, x] <= KEEP_NEAR_PX + 3

    def bridge(stroke) -> bool:
        length = sum(math.dist(a, b) for a, b in zip(stroke, stroke[1:]))
        return length <= BRIDGE_PX and on_kept(stroke[0]) and on_kept(stroke[-1])

    to_dropped = ndimage.distance_transform_edt(~lines([s for s in dropped if not bridge(s)]))
    rgb = image.convert("RGB").resize((SIZE, SIZE))
    pixels = np.asarray(rgb).copy()
    gray = np.asarray(rgb.convert("L"))
    drawn = gray < np.median(gray) - FAINT_LEVEL  # the page is most of the picture
    erase = drawn & (to_dropped < to_kept) & (to_kept > KEEP_NEAR_PX) & (to_dropped <= LINE_REACH_PX)
    pixels[erase] = np.median(pixels[~drawn], axis=0).astype(np.uint8) if (~drawn).any() else 255
    return Image.fromarray(pixels, "RGB")


def clean_drawing(image: Image.Image) -> Image.Image:
    """The drawing the user copies: the chosen AI drawing itself, cleaned up (gray or uneven page to white, ink to
    crisp black, colour removed). It keeps the drawing's line weight and small details, which re-drawing it from
    the traced strokes lost. The traced strokes come from this same image, so the lesson's guides and the
    measurements still line up with it."""
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


def pipeline_stages(
    source_kind: str, prompt_text: str, chosen: int, n_strokes: int, parts: list[dict], plan: dict,
    n_candidates: int = N_CANDIDATES, source_note: str | None = None,
) -> list[dict]:
    """The "How this lesson was made" stages, in the order the contract requires. `source_note` replaces the
    photo stage's first sentence (the live server: the photo was named, not traced)."""
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
         "text": f"SDXL-Lightning drew {n_candidates} line-art drafts, 4 steps each."},
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
    source_note: str | None = None,
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
                                    source_note),
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


def make_pack(
    *, pack_id: str, subject: str, title: str, difficulty: str, source_kind: str, prompt: str | None,
    subject_words: str, seed: int, generate, detect, retries: int = 1, photo: Image.Image | None = None, log=print,
    always: bool = False, check_drawing=None, rate: bool = False, limit: int = MAX_STROKES,
    min_strokes: int = MIN_STROKES, source_note: str | None = None,
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

    generate(seed) returns candidate drawings (seeds seed, seed + 1, ...); detect(image) returns parts."""
    prompt_text = line_art_prompt(subject_words, difficulty=difficulty)
    tries = []
    for attempt in range(retries + 1):
        first_seed = seed + attempt * RETRY_SEED_OFFSET
        candidates = []
        for i, image in enumerate(generate(first_seed)):
            image = remove_strays(remove_frame(image))
            cut_off = is_cut_off(image)  # before fitting, which puts space around everything
            image = fit_to_page(image)
            strokes = trace(image)
            candidates.append(Candidate(image, strokes, line_metrics(image)["score"], cut_off))
            log(f"  candidate {i} (seed {first_seed + i}): {len(strokes)} strokes, score {candidates[-1].score:.1f}"
                + (", cut off at the edge" if candidates[-1].cut_off else ""))
        tries.append(candidates)
        chosen = choose(candidates, min_strokes, limit)
        if chosen is not None:
            break
    else:
        chosen = choose_anyway(candidates, min_strokes) if always else None
        if chosen is not None:
            log(f"  no candidate fit {min_strokes}-{MAX_STROKES} strokes: using candidate {chosen}, simplified")
    if chosen is None:
        counts = "; ".join(", ".join(str(len(c.strokes)) for c in t) for t in tries)
        raise NoCleanCandidate(
            f"No candidate had {min_strokes}-{MAX_STROKES} strokes and a clean score (stroke counts: {counts}). "
            "Try another --seed or a simpler --prompt."
        )

    best = candidates[chosen]
    n_traced = len(best.strokes)
    if check_drawing is not None:
        check_drawing(best.image)
    parts = detect(best.image)
    simplified = len(best.strokes) > limit
    dropped = []  # the strokes a simplified lesson leaves out
    if simplified:
        details = [p["box"] for p in parts if p["id"].split("_")[0] not in WHOLE_PARTS]
        kept = simplify(best.strokes, limit, details)
        kept_ids = {id(stroke) for stroke in kept}
        dropped = [stroke for stroke in best.strokes if id(stroke) not in kept_ids]
        best = Candidate(best.image, kept, best.score, best.cut_off)
    if rate:
        difficulty = rate_difficulty(len(best.strokes))  # what the user will draw (the reference shows just these)
    plan = build_plan(best.strokes, parts, subject=subject)
    pack = assemble_pack(pack_id, subject, title, difficulty, source_kind, prompt, prompt_text, chosen,
                         n_traced, parts, plan, n_candidates=len(candidates), source_note=source_note)
    target = clean_drawing(without_strokes(best.image, best.strokes, dropped) if simplified else best.image)
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
