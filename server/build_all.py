"""Builds every ready-made subject pack in one run, keeping the models loaded between packs.

Run from the repo root, with server/.venv active (needs the GPU):
    python server/build_all.py                      # every pack in PACKS
    python server/build_all.py --only cat,house     # just these subjects

Each pack is built exactly as build_pack.py builds it (4 candidates, a retry with new seeds, the 6-60 stroke
gate). If no candidate passes, the subject's next wording is tried: the house needs a simpler one than
"a house", whose drawings come with bushes, porches and ground lines (98 to 141 strokes in the speed test).
One subject failing never stops the others. At the end it prints a summary table for server/PACK_QA.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER_DIR))  # so `build_pack` and `pipeline` import when run as a script

from build_pack import SUBJECTS_DIR, build, parse_args  # noqa: E402

# (subject id, difficulty, wordings to try in order). The first wording that gives a clean drawing wins.
PACKS = [
    ("fox", "medium", ["a fox"]),
    ("cat", "medium", ["a cat"]),
    ("face", "medium", ["a face"]),
    ("mug", "medium", ["a mug"]),
    ("sneaker", "medium", ["a sneaker"]),
    ("house", "medium", ["a simple house", "a small house with one door and one window", "a house"]),
    ("bird", "medium", ["a bird"]),
    ("fish", "medium", ["a fish"]),
]


def summarize(folder: Path, wording: str, seconds: float) -> dict:
    """The numbers PACK_QA.md needs, read back from the pack that was just written."""
    pack = json.loads((folder / "pack.json").read_text(encoding="utf-8"))
    drawn = [s for s in pack["strokes"] if s["tier"] != "construction"]
    size_kb = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file()) / 1024
    chosen = next(s["image"] for s in pack["pipeline"] if s["id"] == "chosen")
    return {
        "pack": pack["id"], "wording": wording, "strokes": len(drawn), "steps": len(pack["steps"]),
        "parts": [p["id"] for p in pack["parts"]], "chosen": Path(chosen).stem, "kb": round(size_kb),
        "seconds": round(seconds, 1),
    }


def build_one(subject: str, difficulty: str, wordings: list[str], build_fn=build,
              subjects_dir: Path = SUBJECTS_DIR) -> dict:
    """Builds one pack, trying each wording until one passes the gate. `build_fn` is faked in tests."""
    for wording in wordings:
        print(f"\n== {subject}-{difficulty}: \"{wording}\"")
        start = time.perf_counter()
        args = parse_args(["--subject", subject, "--difficulty", difficulty, "--prompt", wording])
        try:
            folder = build_fn(args, subjects_dir=subjects_dir)
        except SystemExit as error:  # build() stops this way when no candidate passes the gate
            print(f"   no clean drawing with \"{wording}\": {error}")
            continue
        return summarize(folder, wording, time.perf_counter() - start)
    return {"pack": f"{subject}-{difficulty}", "wording": None}


def table(results: list[dict]) -> str:
    lines = ["| Pack | Wording | Strokes | Steps | Parts | Chosen | Size | Time |",
             "|---|---|---|---|---|---|---|---|"]
    for r in results:
        if r["wording"] is None:
            lines.append(f"| {r['pack']} | FAILED: no wording passed the gate | | | | | | |")
        else:
            lines.append(f"| {r['pack']} | {r['wording']} | {r['strokes']} | {r['steps']} | "
                         f"{', '.join(r['parts']) or 'none'} | {r['chosen']} | {r['kb']} KB | {r['seconds']} s |")
    return "\n".join(lines)


def main(argv: list[str] | None = None, build_fn=build, subjects_dir: Path = SUBJECTS_DIR) -> int:
    parser = argparse.ArgumentParser(description="Build every ready-made subject pack.")
    parser.add_argument("--only", help="comma-separated subject ids, e.g. 'cat,house'")
    args = parser.parse_args(argv)
    wanted = {s.strip() for s in args.only.split(",")} if args.only else None
    packs = [p for p in PACKS if wanted is None or p[0] in wanted]
    if wanted and len(packs) != len(wanted):
        known = ", ".join(p[0] for p in PACKS)
        parser.error(f"unknown subject in --only (known: {known})")
    results = [build_one(subject, difficulty, wordings, build_fn, subjects_dir)
               for subject, difficulty, wordings in packs]
    print("\n" + table(results))
    failed = [r["pack"] for r in results if r["wording"] is None]
    if failed:
        print(f"\nNo pack for: {', '.join(failed)}. Try other wordings or seeds with build_pack.py.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
