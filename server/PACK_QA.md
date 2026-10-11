# Pack QA

Every pack on the site, checked in the pack inspector (`?debug=pack&id=<packId>`): big shapes first and details
last, part boxes on the right parts, 6 to 60 strokes, step labels that make sense. All were built on the RTX 4060 Ti
by `server/build_all.py` (SDXL + SDXL-Lightning, icon_clean prompt), traced, given parts (OWLv2 or a hand-placed
override in `server/overrides/`) and validated against `pipeline/schema.py`.

| Pack | Strokes | Steps | Parts | Seed / chosen | Verdict |
|---|---|---|---|---|---|
| fox-medium | 42 | 21 | head, body, ears, eyes, legs, tail (override) | 0 / candidate-2 | OK. Left eye is merged into the cheek line. |
| cat-medium | 53 | 21 | head, body, ears, eyes, tail, legs (override) | 0 / candidate-1 | OK. Detection had the body box on the front half only. |
| face-medium | 30 | 14 | head, nose, mouth, ears | 0 / candidate-2 | OK. Eyes are empty ovals. |
| mug-medium | 7 | 4 | body, handle, rim | 0 / candidate-0 | OK. |
| sneaker-medium | 29 | 11 | sole, toe, laces, heel | 10 / candidate-2 | OK. Seed 0 had a swoosh-like logo, so it was rebuilt. |
| house-medium | 45 | 19 | roof, wall, door, windows, chimney | 10 (retry 111) / candidate-1 | OK. Needed icon wording; plain wordings gave 81+ strokes. Bushes and a squiggle on a plant. |
| bird-medium | 42 | 22 | head, body, beak, wing, tail, legs (override) | 0 / candidate-1 | OK. Detection put the head box on the beak. |
| fish-medium | 41 | 19 | body, tail, fins, eye, mouth (override) | 10 / candidate-3 | OK. Seed 0 had a circle frame. Stripes are dashed. |
| fox-simple | 27 | 12 | head, ear, eyes | 0 / candidate-1 | OK. No body, tail or leg boxes. |
| cat-simple | 35 | 16 | head, body, ears, eyes | 0 / candidate-1 | OK. |
| mug-simple | 8 | 4 | body, handle, rim | 0 / candidate-0 | OK. |

Not shipped: fox-detailed (came out in colour; quality.py's colour check missed it), cat-detailed (circle frame),
face-simple (an eye box on the eyebrow), face/mug-detailed (no more detailed than medium).

Known limits, for after the event:
- The builder keeps the candidate with the fewest strokes, so "detailed" isn't more detailed and a cleaner drawing with
  a few more strokes can lose. Choosing by a stroke band per difficulty, then by quality score, would fix both.
- The colour check averages over dark pixels only, so a pale coloured fill can slip through.
- Frames (a circle around the whole drawing) aren't detected automatically.
