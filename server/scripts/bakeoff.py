"""Compares image models on the same subjects, through exactly the live pipeline (api.build_live_pack). Needs the GPU.

Set the model with the same environment variables the live server reads, then run one configuration at a time
(each run loads its own models, so stop the live server first: an 8 GB card can't hold two copies):

    $env:GHOSTLINES_MODEL = "flux"; python server/scripts/bakeoff.py --out server/out/bake/flux-1 --drafts 1
    $env:GHOSTLINES_MODEL = "sdxl"; python server/scripts/bakeoff.py --out server/out/bake/sdxl-2 --drafts 2

For each subject it saves the lesson's reference (target.png), the AI drafts it was chosen from and the pack's
text into <out>/<subject>/, and the seconds each lesson took into <out>/results.json. The first subject is drawn
twice and only the second time counts, because the first run also loads the models.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))
sys.path.insert(0, str(SERVER_DIR / "scripts"))

# What visitors and judges type, including the subjects that came out worst in the Oct 13 live test (two cars, a
# black dragon, a frame-filling basketball, a crossed airplane, a sneaker with a loose sole).
SUBJECTS = [
    "a cat", "a dog", "a horse", "an owl", "a lion", "a dragon", "a unicorn", "a robot", "a car", "a bicycle",
    "an airplane", "a sneaker", "a basketball", "a house", "a castle", "a tree", "a guitar", "a turtle", "a rocket",
    "a teapot",
]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="folder for this configuration's lessons")
    parser.add_argument("--drafts", type=int, default=0, help="drafts per lesson (default: the live server's)")
    parser.add_argument("--difficulty", default="medium", choices=["simple", "medium", "detailed"])
    parser.add_argument("--subjects", help="comma-separated subjects instead of the standard 20")
    args = parser.parse_args(argv)
    if args.drafts:
        os.environ["GHOSTLINES_LIVE_CANDIDATES"] = str(args.drafts)  # read by api.live_candidates()

    import api  # after the settings above: it reads them when drawing
    from try_live import save_data_url

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    subjects = [s.strip() for s in args.subjects.split(",")] if args.subjects else SUBJECTS
    config = {k: v for k, v in os.environ.items() if k.startswith("GHOSTLINES_")}
    print("configuration:", config, flush=True)

    start = time.perf_counter()
    api.build_live_pack(subjects[0], None, args.difficulty)  # loads every model; not counted
    print(f"models loaded and warmed up in {time.perf_counter() - start:.1f} s", flush=True)

    results = []
    for subject in subjects:
        start = time.perf_counter()
        try:
            pack = api.build_live_pack(subject, None, args.difficulty)
        except Exception as error:  # noqa: BLE001 - a refused or failed lesson is a result too
            results.append({"subject": subject, "seconds": round(time.perf_counter() - start, 1), "error": repr(error)})
            print(results[-1], flush=True)
            continue
        seconds = time.perf_counter() - start
        folder = out / slug(subject)
        folder.mkdir(exist_ok=True)
        save_data_url(pack["target"], folder / "target.png")
        stages = {s["id"]: s for s in pack["pipeline"]}
        for i, url in enumerate(stages["candidates"]["images"]):
            save_data_url(url, folder / f"candidate-{i}.webp")
        lean = {k: v for k, v in pack.items() if k not in ("target", "thumb", "pipeline")}
        lean["pipeline"] = [{k: v for k, v in s.items() if k not in ("image", "images")} for s in pack["pipeline"]]
        (folder / "pack.json").write_text(json.dumps(lean, indent=1))
        strokes = sum(s["tier"] != "construction" for s in pack["strokes"])
        results.append({"subject": subject, "seconds": round(seconds, 1), "strokes": strokes,
                        "rated": pack["difficulty"], "drafts": len(stages["candidates"]["images"])})
        print(results[-1], flush=True)
    timed = sorted(r["seconds"] for r in results if "error" not in r)
    summary = {"config": config, "lessons": len(timed), "errors": len(results) - len(timed),
               "median_s": timed[len(timed) // 2] if timed else None,
               "max_s": timed[-1] if timed else None}
    (out / "results.json").write_text(json.dumps({"summary": summary, "results": results}, indent=1))
    print("summary:", summary, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
