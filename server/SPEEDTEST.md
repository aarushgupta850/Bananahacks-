# Speed test (A1b)

Measured by `server/scripts/speedtest.py`, last run 2026-10-11 13:58. Images are in `server/out/speedtest/` (not committed).

## Machine

- GPU: NVIDIA GeForce RTX 4060 Ti, 8.0 GB VRAM (model CPU offload on)
- torch 2.14.1+cu130, diffusers 0.41.0, transformers 5.19.0, Python 3.11.9

## Timing

| Stage | Load | Per image | Peak VRAM |
|---|---|---|---|
| Text to line art (SDXL-Lightning, 4 steps, 1024 px) | 15.7 s | first 5.6 s, then median 4.8 s (24 images) | 5.07 GB |
| Photo to line art | skipped: no photo at test_photo.jpg yet | | |
| Part detection (OWLv2, per image) | 0.6 s | 0.21 s | 0.79 GB |

## Prompt comparison (8 subjects, cleanest first)

Score from `server/pipeline/quality.py`, lower is cleaner: specks + half the separate pieces + 50 x gray-per-ink ratio (shading) + penalties for solid fills, a blank page or color (an image scoring 1000+ is rejected). Earlier runs' images are re-scored with the current quality.py, so every variant is judged the same way. Ranked by best of N: each subject's best seed, averaged over subjects, because the pack builder keeps the cleanest of several candidates.

| Variant | Images | Best of N | Median | Mean | Rejected | Gray ratio | Color | Seconds |
|---|---|---|---|---|---|---|---|---|
| icon_clean | 24 | 30.1 | 50.3 | 120.0 | 1 | 0.56 | 0.02 | 4.9 |
| icon | 24 | 33.0 | 57.6 | 92.3 | 0 | 0.48 | 0.01 | 5.0 |
| icon_mono | 24 | 79.6 | 69.2 | 182.7 | 1 | 0.63 | 0.01 | 4.9 |
| kids | 16 | 482.3 | 694.4 | 850.5 | 6 | 1.56 | 0.01 | 4.7 |
| playbook | 16 | 942.3 | 1077.5 | 1058.2 | 9 | 1.70 | 0.01 | 4.7 |
| baseline | 16 | 1048.7 | 1225.6 | 1270.2 | 8 | 1.88 | 0.01 | 4.8 |

Best score per subject (the candidate the pack builder would keep):

| Variant | fox | cat | face | mug | sneaker | house | bird | fish |
|---|---|---|---|---|---|---|---|---|
| icon_clean | 27.8 | 30.0 | 14.4 | 8.3 | 45.0 | 47.1 | 18.0 | 50.0 |
| icon | 11.9 | 26.3 | 14.3 | 10.9 | 33.5 | 96.7 | 11.0 | 59.3 |
| icon_mono | 60.8 | 75.2 | 18.6 | 15.3 | 41.3 | 334.3 | 48.4 | 42.4 |
| kids | 604.9 | 144.3 | 783.9 | 408.9 | 248.8 | 982.0 | 250.1 | 435.9 |
| playbook | 1619.9 | 438.1 | 1552.7 | 201.2 | 239.6 | 1825.2 | 1104.2 | 557.8 |
| baseline | 1876.3 | 761.2 | 1601.1 | 214.2 | 207.6 | 1982.1 | 808.9 | 937.9 |

Cleanest by best-of-N score: **icon_clean**. Chosen prompt (`CHOSEN` in `server/pipeline/prompts.py`): **icon_clean**, also checked by eye in the grid-*.webp images:

```
minimalist line icon of {subject}, full body, bold uniform black outline only, flat, very few lines, no details, no shading, no solid black areas, no text, no logo, isolated on plain white background
```

## Checked by eye

- baseline, playbook and kids: detailed illustrations with fur/feather hatching, frames and backgrounds; too hard for a beginner to copy.
- icon: bold, uniform outlines, the first usable style; but some head-only busts, a brand-like swoosh on sneakers, garbled text on a house and solid black fills.
- icon_clean (CHOSEN): whole bodies for cat, fox and bird, no garbled text, no cartoon faces; picked by eye for 7 of 8 subjects. One fox seed came out in full color, which led to quality.py's color reject.
- icon_mono: 'black and white' removed color but made drawings more detailed (fur, fills); 'no frame' did not remove circle frames and added rectangular ones on some seeds. Rejected.
- Backgrounds are light gray (about #d8 to #e0), not white, in every variant: tracing must threshold first.
- OWLv2 parts: subject-qualified labels ('cat head') score far higher than plain ones ('head'). Distinctive parts (handle, beak, chimney, door, tail) are reliable; paired parts return only one box (one ear, one eye); a few boxes are wrong (bird 'head' = whole bird, fish 'mouth' on a fin, sneaker 'heel' = whole upper).

## Parts (OWLv2 on each subject's cleanest drawing)

Best score per part, for the plain label ("head") and the subject-qualified one ("fox head"). Found = best score at least 0.1; boxes are drawn in `owl-<subject>.png` (blue at 0.1 or more, orange from 0.05).

| Subject | Found | Part scores (plain / qualified) |
|---|---|---|
| fox (`text-fox-icon_clean-2.png`) | 0/6 | head 0.022 / 0.099, body 0.001 / 0.015, ear 0.028 / 0.054, eye 0.019 / 0.096, tail 0.056 / 0.048, leg 0.007 / 0.066 |
| cat (`text-cat-icon_clean-2.png`) | 6/6 | head 0.018 / 0.303, body 0.001 / 0.178, ear 0.041 / 0.225, eye 0.046 / 0.213, tail 0.170 / 0.274, leg 0.020 / 0.145 |
| face (`text-face-icon_clean-0.png`) | 6/6 | head 0.402 / 0.371, eye 0.110 / 0.112, nose 0.132 / 0.288, mouth 0.113 / 0.163, ear 0.103 / 0.165, hair 0.037 / 0.102 |
| mug (`text-mug-icon_clean-1.png`) | 3/3 | body 0.002 / 0.547, handle 0.355 / 0.692, rim 0.034 / 0.371 |
| sneaker (`text-sneaker-icon_clean-0.png`) | 3/4 | sole 0.403 / 0.391, toe 0.087 / 0.237, laces 0.468 / 0.532, heel 0.075 / 0.087 |
| house (`text-house-icon_clean-2.png`) | 5/5 | roof 0.339 / 0.393, wall 0.024 / 0.108, door 0.080 / 0.130, window 0.161 / 0.249, chimney 0.157 / 0.255 |
| bird (`text-bird-icon_clean-1.png`) | 5/6 | head 0.014 / 0.098, body 0.001 / 0.271, wing 0.148 / 0.233, tail 0.022 / 0.221, beak 0.322 / 0.463, leg 0.009 / 0.169 |
| fish (`text-fish-icon_clean-2.png`) | 5/5 | body 0.003 / 0.449, tail 0.036 / 0.514, fin 0.161 / 0.501, eye 0.149 / 0.367, mouth 0.037 / 0.400 |

## Models

| Model | Used for | License |
|---|---|---|
| [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) | text encoders, VAE and config | CreativeML Open RAIL++-M (openrail++) |
| [ByteDance/SDXL-Lightning](https://huggingface.co/ByteDance/SDXL-Lightning) | 4-step UNet | CreativeML Open RAIL++-M (openrail++) |
| [TheMistoAI/MistoLine](https://huggingface.co/TheMistoAI/MistoLine) | line-art ControlNet, photo path | CreativeML Open RAIL++-M (openrail++) |
| [lllyasviel/Annotators](https://huggingface.co/lllyasviel/Annotators) | line-art detector weights | listed as "other" on the model page |
| [google/owlv2-base-patch16-ensemble](https://huggingface.co/google/owlv2-base-patch16-ensemble) | part detection | Apache-2.0 |
