"""The text prompt for the text-to-line-art path (SDXL-Lightning, 4 steps, guidance 0).

With guidance 0 the model ignores negative prompts, so everything we want (and don't want) has to be
said in the positive prompt. scripts/speedtest.py generates every variant below, scores how clean the
lines are, and the cleanest one becomes CHOSEN.

Keep each prompt short: SDXL's text encoders read at most 77 tokens and silently drop the rest.
"""

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
    # "icon_whole" said only with what we want: CLIP, SDXL's text encoder, often reads "no X" as "X", so the long
    # list of "no ..." may itself bring shading and sketch lines. Tried on Oct 13.
    "icon_plain": (
        "minimalist line icon of {subject}, full body, bold uniform pure black outline, single clean continuous "
        "lines, closed shapes, white inside, very few lines, simple flat vector style, isolated on plain white "
        "background"
    ),
    # "icon_whole" asking for pure black on pure white, against faint gray lines and gray fills. Tried on Oct 13.
    "icon_contrast": (
        "minimalist line icon of {subject}, full body, pure black lines on pure white, high contrast, "
        "bold uniform outline, single clean continuous lines, very few lines, no gray, no shading, "
        "no text, isolated on plain white background"
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
