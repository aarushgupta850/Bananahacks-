"""Builds a lesson plan for drawings and prints it: trace -> parts -> order (A2b's check).

Run from the repo root, with server/.venv active (part detection needs the GPU either way):
    python server/scripts/try_plan.py                                   # generate 1 fox, plan it
    python server/scripts/try_plan.py --subject "a cat" --seed 2
    python server/scripts/try_plan.py --images "server/out/trace/fox-medium-2.png" --subject "a fox"

Prints each step (label, tier, stroke count, tip) and saves server/out/plan/<name>-plan.png: the drawing
faded, part boxes labeled in blue, and strokes numbered in drawing order, colored by tier.
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline import models  # noqa: E402
from pipeline.order import build_plan  # noqa: E402
from pipeline.parts import detect_parts, subject_slug  # noqa: E402
from pipeline.trace import trace  # noqa: E402

OUT_DIR = SERVER_DIR / "out" / "plan"
TIER_COLORS = {  # construction -> outline -> structure -> details, light to strong
    "construction": (160, 160, 160),
    "outline": (230, 25, 75),
    "structure": (0, 130, 200),
    "detail": (60, 180, 75),
}


def plan_image(image: Image.Image, parts: list[dict], plan: dict) -> Image.Image:
    base = Image.blend(image.convert("RGB"), Image.new("RGB", image.size, "white"), 0.7)
    draw = ImageDraw.Draw(base)
    for part in parts:
        x, y, w, h = part["box"]
        draw.rectangle((x, y, x + w, y + h), outline=(59, 108, 255), width=2)
        draw.text((x + 4, y + 2), part["label"], fill=(59, 108, 255))
    for n, stroke in enumerate(plan["strokes"], start=1):
        color = TIER_COLORS[stroke["tier"]]
        points = [tuple(p) for p in stroke["points"]]
        if len(points) > 1:
            draw.line(points, fill=color, width=4 if stroke["tier"] != "construction" else 2)
        for kx, ky in stroke["keyPoints"]:
            draw.ellipse((kx - 3, ky - 3, kx + 3, ky + 3), outline=color)
        draw.text((points[0][0] + 5, points[0][1] - 5), str(n), fill=color)
    return base


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trace, find parts and build a lesson plan.")
    parser.add_argument("--subject", default="a fox")
    parser.add_argument("--difficulty", default="medium", choices=["simple", "medium", "detailed"])
    parser.add_argument("--seed", type=int, default=2, help="seed 2 gave the cleanest fox in the speed test")
    parser.add_argument("--images", help="glob of existing drawings to plan instead of generating one")
    args = parser.parse_args(argv)
    print(f"HF_HOME: {models.setup_hf_env() or '(not set)'}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.images:
        drawings = [(Path(p).stem, Image.open(p).convert("RGB")) for p in sorted(glob.glob(args.images))]
        if not drawings:
            print(f"No images match {args.images}")
            return 1
    else:
        from pipeline.generate import from_prompt

        (image,) = from_prompt(args.subject, args.difficulty, n=1, seed=args.seed)
        drawings = [(f"{subject_slug(args.subject)}-{args.difficulty}-{args.seed}", image)]

    for name, image in drawings:
        strokes = trace(image)
        parts = detect_parts(image, args.subject)
        plan = build_plan(strokes, parts, subject=subject_slug(args.subject))
        tiers = {t: sum(s["tier"] == t for s in plan["strokes"]) for t in TIER_COLORS}
        print(f"\n== {name}: {len(strokes)} traced strokes, {len(parts)} parts, "
              f"{len(plan['strokes'])} plan strokes, {len(plan['steps'])} steps ==")
        print("parts: " + (", ".join(f"{p['label']} {p['box']}" for p in parts) or "none found"))
        print("tiers: " + ", ".join(f"{t} {n}" for t, n in tiers.items()))
        for step in plan["steps"]:
            print(f"  {step['id']:<8} {step['tier']:<12} {len(step['strokeIds'])} stroke(s)  "
                  f"{step['label']:<28} {step['tip']}")
        image.save(OUT_DIR / f"{name}.png")
        plan_image(image, parts, plan).save(OUT_DIR / f"{name}-plan.png")
    print(f"\nPlan overlays: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
