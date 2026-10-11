"""Traces drawings into strokes and saves overlays to check by eye.

Run from the repo root, with server/.venv active:
    python server/scripts/try_trace.py                         # generate 4 foxes (GPU) and trace them
    python server/scripts/try_trace.py --subject "a cat" --n 4
    python server/scripts/try_trace.py --images "server/out/speedtest/text-*-icon_clean-*.png"   # no GPU

For each drawing it prints the stroke count (the pack quality gate wants 6 to 60) and the cleanliness score,
and saves an overlay to server/out/trace/: the drawing faded, each stroke on top in its own color with its
number at its start. A good trace looks like strokes an artist would draw, not hundreds of fragments.
"""

from __future__ import annotations

import argparse
import glob
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))  # so `pipeline` and `scripts` import when run as a script

from pipeline.quality import line_metrics  # noqa: E402
from pipeline.trace import ink_mask, skeleton_of, trace  # noqa: E402

OUT_DIR = SERVER_DIR / "out" / "trace"
MIN_STROKES, MAX_STROKES = 6, 60  # the pack quality gate
# Distinct, saturated colors, so neighboring strokes are easy to tell apart.
PALETTE = [
    (230, 25, 75), (60, 180, 75), (0, 130, 200), (245, 130, 48), (145, 30, 180), (70, 200, 220),
    (240, 50, 230), (150, 180, 20), (0, 128, 128), (170, 110, 40), (128, 0, 0), (0, 0, 128),
]


def overlay(image: Image.Image, strokes: list[list[tuple[float, float]]]) -> Image.Image:
    base = Image.blend(image.convert("RGB").resize((768, 768)), Image.new("RGB", (768, 768), "white"), 0.65)
    draw = ImageDraw.Draw(base)
    for i, stroke in enumerate(strokes):
        color = PALETTE[i % len(PALETTE)]
        if len(stroke) > 1:
            draw.line(stroke, fill=color, width=4, joint="curve")
        x, y = stroke[0]
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color)  # where the stroke starts
        draw.text((x + 6, y - 6), str(i), fill=color)
    return base


def skeleton_image(image: Image.Image) -> Image.Image:
    """The 1-px skeleton, black on white (the pack builder will save this as pipeline/skeleton.webp)."""
    skeleton = skeleton_of(ink_mask(image))
    return Image.fromarray((~skeleton * 255).astype("uint8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trace drawings into strokes and save overlays.")
    parser.add_argument("--subject", default="a fox")
    parser.add_argument("--difficulty", default="medium", choices=["simple", "medium", "detailed"])
    parser.add_argument("--n", type=int, default=4, help="drawings to generate")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--images", help="glob of existing drawings to trace instead of generating (no GPU)")
    args = parser.parse_args(argv)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.images:
        paths = sorted(glob.glob(args.images))
        if not paths:
            print(f"No images match {args.images}")
            return 1
        drawings = [(Path(p).stem, Image.open(p).convert("RGB")) for p in paths]
    else:
        from pipeline import models

        print(f"HF_HOME: {models.setup_hf_env() or '(not set)'}")
        from pipeline.generate import from_prompt

        start = time.perf_counter()
        images = from_prompt(args.subject, args.difficulty, n=args.n, seed=args.seed)
        print(f"Generated {len(images)} drawings in {time.perf_counter() - start:.1f} s")
        slug = "-".join(args.subject.lower().split()[-1:])
        drawings = [(f"{slug}-{args.difficulty}-{args.seed + i}", image) for i, image in enumerate(images)]

    in_gate = 0
    for name, image in drawings:
        start = time.perf_counter()
        strokes = trace(image)
        ms = (time.perf_counter() - start) * 1000
        score = line_metrics(image)["score"]
        ok = MIN_STROKES <= len(strokes) <= MAX_STROKES
        in_gate += ok
        points = sum(len(s) for s in strokes)
        print(f"{name:<32} {len(strokes):3d} strokes {'(in gate)' if ok else '(OUTSIDE 6-60)'}  "
              f"{points:4d} points  score {score:7.1f}  traced in {ms:4.0f} ms")
        if not args.images:
            image.save(OUT_DIR / f"{name}.png")
        overlay(image, strokes).save(OUT_DIR / f"{name}-strokes.png")
        skeleton_image(image).save(OUT_DIR / f"{name}-skeleton.png")
    print(f"\n{in_gate}/{len(drawings)} drawings inside the 6-60 stroke gate. Overlays: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
