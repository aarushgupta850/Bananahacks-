"""Builds lessons from saved AI drafts, without the GPU, to compare two versions of the pipeline on the same drafts.

The live server's packs include their drafts (pipeline/candidate-*.webp), so a folder of saved packs can be rebuilt
with any checkout of the code: the drafts stand in for SDXL, and parts are skipped (they need OWLv2).

    python server/scripts/compare_drafts.py build <drafts dir> <out dir> [n]  # with this checkout's server code
    python server/scripts/compare_drafts.py sheet <old out> <new out> <sheet.png>

`build` looks for folders holding candidate-*.webp anywhere under <drafts dir>; a folder's (or its parent's) name
holds its difficulty, e.g. "a-cat-simple" or "a-cat-simple-s0". With n, only the first n drafts of each folder are
used (the live server draws 3; saved packs hold 4). It writes <name>.png (the lesson's reference) and <name>.json
(the chosen draft and the lesson's strokes), and prints how many strokes were traced and kept. `sheet` puts the two
versions' references side by side, one row per lesson, plus the new reference with its lesson's strokes in red.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

LIMITS = {"simple": 25, "medium": 50, "detailed": 60}  # as LIVE_STROKE_LIMITS in api.py


def draft_folders(root: Path) -> list[tuple[str, str, list[Path]]]:
    """(name, difficulty, draft files) for every folder of drafts under root."""
    found = []
    for folder in sorted({p.parent for p in root.rglob("candidate-*.webp")}):
        named = folder if folder.name != "pipeline" else folder.parent
        difficulty = next((d for d in LIMITS if f"-{d}" in named.name), "medium")
        name = named.name if named.parent == root else f"{named.parent.name}-{named.name}"
        found.append((name, difficulty, sorted(folder.glob("candidate-*.webp"))))
    return found


def build(root: Path, out: Path, n: int | None = None) -> None:
    from build_pack import make_pack

    out.mkdir(parents=True, exist_ok=True)
    for name, difficulty, files in draft_folders(root):
        drafts = [Image.open(f).convert("RGB") for f in files[:n]]
        lines = []
        pack, assets = make_pack(
            pack_id=f"compare-{difficulty}", subject="compare", title=name, difficulty=difficulty,
            source_kind="prompt", prompt=name, subject_words=name, seed=0, generate=lambda seed: drafts,
            detect=lambda image: [], retries=0, log=lines.append, always=True, rate=True, limit=LIMITS[difficulty],
        )
        (out / f"{name}.png").write_bytes(assets["target.png"])
        chosen = next(s for s in pack["pipeline"] if s["id"] == "chosen")
        lesson = [s["points"] for s in pack["strokes"] if s["tier"] != "construction"]
        (out / f"{name}.json").write_text(json.dumps({"chosen": chosen["image"], "strokes": lesson}))
        print(f"{name}: {chosen['text']} Kept {len(pack['strokes'])}, rated {pack['difficulty']}.")
        for line in lines:
            print("   ", line)


def sheet(old: Path, new: Path, path: Path, cell: int = 384) -> None:
    names = sorted(p.stem for p in new.glob("*.png") if (old / p.name).exists())
    canvas = Image.new("RGB", (3 * cell, max(1, len(names)) * (cell + 20)), "white")
    draw = ImageDraw.Draw(canvas)
    for row, name in enumerate(names):
        y = row * (cell + 20)
        for col, folder in enumerate((old, new)):
            image = Image.open(folder / f"{name}.png").convert("RGB").resize((cell, cell))
            canvas.paste(image, (col * cell, y + 20))
        strokes_file = new / f"{name}.json"
        if strokes_file.exists():  # the new reference again, with the strokes its lesson teaches in red
            overlay = Image.open(new / f"{name}.png").convert("RGB")
            pen = ImageDraw.Draw(overlay)
            for stroke in json.loads(strokes_file.read_text())["strokes"]:
                pen.line([tuple(p) for p in stroke], fill=(230, 40, 40), width=3)
            canvas.paste(overlay.resize((cell, cell)), (2 * cell, y + 20))
        draw.text((4, y + 4), f"{name}: before | after | after with its lesson's strokes", fill=(0, 0, 0))
    buffer = io.BytesIO()
    canvas.save(buffer, "PNG")
    path.write_bytes(buffer.getvalue())
    print(f"wrote {path} ({len(names)} lessons)")


if __name__ == "__main__":
    if len(sys.argv) in (4, 5) and sys.argv[1] == "build":
        build(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) == 5 else None)
    elif len(sys.argv) == 5 and sys.argv[1] == "sheet":
        sheet(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
    else:
        sys.exit(__doc__)
