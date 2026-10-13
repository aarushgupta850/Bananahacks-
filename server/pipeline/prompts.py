"""The text prompt for the text-to-line-art path (SDXL-Lightning, 4 steps, guidance 0).

With guidance 0 the model ignores negative prompts, so everything we want (and don't want) has to be
said in the positive prompt. scripts/speedtest.py generates every variant below, scores how clean the
lines are, and the cleanest one becomes CHOSEN.

Keep each prompt short: SDXL's text encoders read at most 77 tokens and silently drop the rest.
"""

import os

VARIANTS = {
    # The first prompt we tried. It gave detailed, hatched portraits with decorative frames.
    "baseline": (
        "simple black ink line drawing of {subject}, clean continuous outlines, "
        "minimal line art, coloring book page, plain white background, "
        "no shading, no color, no texture, centered, full view"
    ),
    # The prompt suggested in the A1b plan.
    "playbook": (
        "simple clean black line drawing of {subject}, single subject, centered, white background, "
        "thick even outlines, no shading, no color, coloring book style"
    ),
    # Pushes hard toward few, thick lines and the whole subject.
    "kids": (
        "very simple coloring page for young children, {subject}, whole body, side view, "
        "a few thick black outlines, no fur, no hatching, no texture, no frame, no background, white paper"
    ),
    # Icon style: bold, uniform, closed outlines. Clearly the cleanest in the first speed test
    # (mean score 106 vs 850+ for the others, over 8 subjects).
    "icon": (
        "minimalist line icon of {subject}, whole body, bold uniform black outline, flat, "
        "very few lines, no details, no shading, no fill, isolated on plain white background"
    ),
    # "icon" plus fixes for what the first speed test showed it still does sometimes:
    # brand logos (a swoosh on every sneaker), garbled text, solid black areas and head-only busts.
    "icon_clean": (
        "minimalist line icon of {subject}, full body, bold uniform black outline only, flat, "
        "very few lines, no details, no shading, no solid black areas, no text, no logo, "
        "isolated on plain white background"
    ),
    # "icon_clean" asking for single, clean lines: its drawings often had doubled, sketchy outlines (the cat's back
    # and tail), which make a confusing target and a longer lesson. Chosen for live generation on Oct 11.
    "icon_single": (
        "minimalist line icon of {subject}, bold uniform black outline only, single clean continuous lines, "
        "no sketch lines, no double lines, flat, very few lines, no details, no shading, no solid black areas, "
        "no text, no logo, isolated on plain white background"
    ),
    # "icon_single" with "full body" back (it came from "icon_clean"): without it, live lessons for animals were often
    # head close-ups cut off at the edge (a cat's face, a fox's face, a giraffe's head and neck). Chosen on Oct 12.
    # "full body" comes early, so it is never cut off by the 77-token limit; "flat" made room for it.
    "icon_whole": (
        "minimalist line icon of {subject}, full body, bold uniform black outline only, single clean continuous lines, "
        "no sketch lines, no double lines, very few lines, no details, no shading, no solid black areas, "
        "no text, no logo, isolated on plain white background"
    ),
    # "icon_whole" asking for smooth, even, symmetrical curves: the 4-step model draws round and mirror-image things
    # (a basketball's seams, a monkey's face) wobbly and lopsided. "no sketch lines" and "single clean continuous
    # lines" are folded into "smooth even continuous lines" to stay inside the 77-token limit. Not yet compared on
    # the GPU: switch it on with GHOSTLINES_PROMPT=icon_even and look at the drawings before making it CHOSEN.
    "icon_even": (
        "minimalist line icon of {subject}, full body, bold uniform black outline only, smooth even continuous "
        "lines, symmetrical shapes, no double lines, very few lines, no details, no shading, no solid black areas, "
        "no text, no logo, isolated on plain white background"
    ),
    # "icon_clean" plus "black and white, no frame". Tried in the third speed test and rejected: it removed
    # color but made drawings more detailed, and frames stayed. Kept here so the comparison can be rerun.
    "icon_mono": (
        "minimalist black and white line icon of {subject}, full body, bold uniform black outline only, "
        "flat, very few lines, no details, no shading, no solid black areas, no text, no logo, "
        "no frame, no border, isolated on plain white background"
    ),
}

# The variant the pipeline uses. Set from the speed test results (see server/SPEEDTEST.md).
CHOSEN = "icon_whole"  # the shipped packs were built with "icon_clean"

# Extra words per difficulty, placed right after the subject. Must match Difficulty in types.ts.
DIFFICULTY_HINTS = {
    "simple": "very simple, few lines, minimal detail",
    "medium": "",
    "detailed": "more detail, a few interior lines",
}


def active_variant() -> str:
    """The variant to generate with: GHOSTLINES_PROMPT when it's set (to try another variant on the live server
    without editing code), else CHOSEN."""
    variant = os.environ.get("GHOSTLINES_PROMPT", "").strip() or CHOSEN
    if variant not in VARIANTS:
        raise ValueError(f"GHOSTLINES_PROMPT={variant!r} is not a prompt variant; expected one of {sorted(VARIANTS)}")
    return variant


def line_art_prompt(subject: str, variant: str = CHOSEN, difficulty: str = "medium") -> str:
    """Builds the generation prompt for one subject, e.g. 'a fox' or 'a coffee mug'."""
    subject = " ".join(subject.split())  # collapse stray spaces and newlines
    if not subject:
        raise ValueError("subject must not be empty")
    if variant not in VARIANTS:
        raise ValueError(f"unknown prompt variant {variant!r}, expected one of {sorted(VARIANTS)}")
    if difficulty not in DIFFICULTY_HINTS:
        raise ValueError(f"unknown difficulty {difficulty!r}, expected one of {list(DIFFICULTY_HINTS)}")
    if DIFFICULTY_HINTS[difficulty]:
        subject = f"{subject}, {DIFFICULTY_HINTS[difficulty]}"
    return VARIANTS[variant].format(subject=subject)
