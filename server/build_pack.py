"""Builds one subject pack (images + pack.json) for web/public/subjects, in one command.

Run from the repo root, with server/.venv active (needs the GPU). The /build-pack skill calls it like this:
    python server/build_pack.py --subject fox --difficulty medium --prompt "fox"
    python server/build_pack.py --subject mug --difficulty medium --photo server/scripts/test_photo.jpg

What it does:
1. Generates 4 candidate drawings (from the prompt, or redrawn from the photo's lines).
2. Traces each into strokes, and keeps the candidate with the fewest strokes inside the 6-60 gate
   (colored or blank drawings are never kept). If none fits, it tries 4 new seeds once, then stops
   with a clear message.
3. Finds the parts (OWLv2) and builds the lesson plan (tiers, order, steps).
4. Checks the whole pack against pipeline/schema.py (a mirror of types.ts) BEFORE writing anything.
5. Writes web/public/subjects/<subject>-<difficulty>/: target.png (768, clean black lines on white),
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
from pipeline.trace import ink_mask, skeleton_of, trace  # noqa: E402

SUBJECTS_DIR = SERVER_DIR.parent / "web" / "public" / "subjects"
DIFFICULTIES = ["simple", "medium", "detailed"]  # must match Difficulty in web/src/engine/types.ts
N_CANDIDATES = 4
RETRY_SEED_OFFSET = 100  # the retry uses seeds this far from the first try's
MIN_STROKES, MAX_STROKES = 6, 60  # the quality gate (server/CLAUDE.md)
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


def choose(candidates: list[Candidate]) -> int | None:
    """Index of the candidate with the fewest strokes inside the gate (ties: the cleaner score), or None."""
    usable = [
        i for i, c in enumerate(candidates)
        if MIN_STROKES <= len(c.strokes) <= MAX_STROKES and c.score < REJECTED_SCORE
    ]
    if not usable:
        return None
    return min(usable, key=lambda i: (len(candidates[i].strokes), candidates[i].score))


# ---------------------------------------------------------------- images


def smooth(points: list, rounds: int = 2) -> list:
    """Chaikin's corner cutting: each round replaces every corner with two points a quarter of the way
    along its segments, so the simplified polylines render as smooth curves. The ends stay put."""
    for _ in range(rounds):
        if len(points) < 3:
            return points
        closed = points[0] == points[-1]
        out = [] if closed else [points[0]]
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        points = out + [out[0]] if closed else out + [points[-1]]
    return points


def render_target(strokes: list) -> Image.Image:
    """The drawing the user copies: the traced strokes as clean black lines on white. Drawn from the strokes
    themselves, so what the user sees is exactly what their drawing is measured against. Smoothed, and drawn
    at 2x then scaled down, for clean curves and edges."""
    scale = 2
    canvas = Image.new("L", (SIZE * scale, SIZE * scale), 255)
    draw = ImageDraw.Draw(canvas)
    for stroke in strokes:
        points = [(x * scale, y * scale) for x, y in smooth([tuple(p) for p in stroke])]
        if len(points) > 1:
            draw.line(points, fill=0, width=5 * scale, joint="curve")
            for x, y in (points[0], points[-1]):  # round line ends
                r = 2.5 * scale
                draw.ellipse((x - r, y - r, x + r, y + r), fill=0)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


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
    n_candidates: int = N_CANDIDATES,
) -> list[dict]:
    """The "How this lesson was made" stages, in the order the contract requires."""
    candidate_paths = [f"pipeline/candidate-{i}.webp" for i in range(n_candidates)]
    if source_kind == "photo":
        source = {"id": "source", "label": "Photo", "image": "pipeline/source.webp",
                  "text": f"The photo's lines guided the drawing. Prompt: {prompt_text}"}
    else:
        source = {"id": "source", "label": "Prompt", "text": prompt_text}
    part_names = ", ".join(p["label"].lower() for p in parts)
    return [
        source,
        {"id": "candidates", "label": f"{n_candidates} AI drafts", "images": candidate_paths,
         "text": f"SDXL-Lightning drew {n_candidates} line-art drafts, 4 steps each."},
        {"id": "chosen", "label": "Chosen drawing", "image": candidate_paths[chosen],
         "text": f"The draft with the fewest strokes inside {MIN_STROKES}-{MAX_STROKES}: {n_strokes} strokes."},
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
        "pipeline": pipeline_stages(source_kind, prompt_text, chosen, n_strokes, parts, plan, n_candidates),
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
) -> tuple[dict, dict[str, bytes]]:
    """Builds a pack in memory: (pack.json dict, {asset path: file bytes}). Used by build() to write files and
    by the live server (api.py) to return images as data: URLs. Raises NoCleanCandidate if nothing fits.

    generate(seed) returns candidate drawings (seeds seed, seed + 1, ...); detect(image) returns parts."""
    prompt_text = line_art_prompt(subject_words, difficulty=difficulty)
    tries = []
    for attempt in range(retries + 1):
        first_seed = seed + attempt * RETRY_SEED_OFFSET
        candidates = []
        for i, image in enumerate(generate(first_seed)):
            strokes = trace(image)
            candidates.append(Candidate(image, strokes, line_metrics(image)["score"]))
            log(f"  candidate {i} (seed {first_seed + i}): {len(strokes)} strokes, score {candidates[-1].score:.1f}")
        tries.append(candidates)
        chosen = choose(candidates)
        if chosen is not None:
            break
    else:
        counts = "; ".join(", ".join(str(len(c.strokes)) for c in t) for t in tries)
        raise NoCleanCandidate(
            f"No candidate had {MIN_STROKES}-{MAX_STROKES} strokes and a clean score (stroke counts: {counts}). "
            "Try another --seed or a simpler --prompt."
        )

    best = candidates[chosen]
    parts = detect(best.image)
    plan = build_plan(best.strokes, parts, subject=subject)
    pack = assemble_pack(pack_id, subject, title, difficulty, source_kind, prompt, prompt_text, chosen,
                         len(best.strokes), parts, plan, n_candidates=len(candidates))
    target = render_target(best.strokes)
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
            return detect_parts(image, subject_words, pack_id)

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
