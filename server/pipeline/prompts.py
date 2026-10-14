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
    # "icon_whole" said only with what we want: CLIP, SDXL's text encoder, often reads "no X" as "X", so the long
    # list of "no ..." may itself bring shading and sketch lines. Chosen on Oct 13, after two rounds on the live PC
    # (41 subjects, same seeds, judged by eye after the full pipeline): 26 of 33 medium lessons good and 1 bad,
    # against 17 good and 7 bad with "icon_whole". Its drafts traced into fewer strokes (median 53 vs 65 at medium,
    # 40 vs 55 at simple), so less was trimmed away, and fewer had a ring drawn around the subject (9 vs 18 of 141).
    "icon_plain": (
        "minimalist line icon of {subject}, full body, bold uniform pure black outline, single clean continuous "
        "lines, closed shapes, white inside, very few lines, simple flat vector style, isolated on plain white "
        "background"
    ),
    # "icon_plain" pushed further toward few, big shapes. Rejected on Oct 13: more strokes and more rings than "icon_plain".
    # Why it was tried: on Oct 13 even "simple" drafts traced into about 72 strokes,
    # far over a simple lesson's 25, so trimming them left broken, unfinished-looking drawings. Very thick lines leave
    # no room for fine texture.
    "icon_bold": (
        "simple bold cartoon line icon of {subject}, full body, very thick uniform black outline, a few large "
        "closed shapes, white inside, minimal details, flat vector style, isolated on plain white background"
    ),
    # "icon_whole" asking for pure black on pure white, against faint gray lines and gray fills. Rejected on Oct 13:
    # busier drawings (median 106 strokes) with more texture.
    "icon_contrast": (
        "minimalist line icon of {subject}, full body, pure black lines on pure white, high contrast, "
        "bold uniform outline, single clean continuous lines, very few lines, no gray, no shading, "
        "no text, isolated on plain white background"
    ),
    # "icon_plain" asking for smooth, even, symmetrical curves: the 4-step model draws round and mirror-image things
    # (a basketball's seams, a monkey's face) wobbly and lopsided. Said only with what we want, like "icon_plain"
    # ("no X" often reads as "X"), and no longer than it. Not yet compared on the GPU: switch it on with
    # GHOSTLINES_PROMPT=icon_even and judge the drawings before making it CHOSEN.
    "icon_even": (
        "minimalist line icon of {subject}, full body, bold uniform pure black outline, smooth even symmetrical "
        "curves, closed shapes, white inside, very few lines, simple flat vector style, isolated on plain white "
        "background"
    ),
    # For FLUX.1-schnell (GHOSTLINES_IMAGE_MODEL=flux), not SDXL. FLUX reads the prompt with T5, a language model: there's
    # no 77-token limit, and it understands plain sentences and "no ..." the way a person would, so this says what a
    # lesson needs directly: one whole subject, outlines only, nothing else on the page.
    "flux_line": (
        "A simple black-and-white line drawing of {subject}, like a page in a children's coloring book. "
        "Just one of it, whole and centered, with plenty of white space around it. Clean, smooth, bold black "
        "outlines of even width, closed shapes with white insides, very few lines. No shading, no gray, no color, no "
        "filled black areas, no background, no frame, no text, nothing else in the picture."
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
CHOSEN = "icon_plain"  # the shipped packs were built with "icon_clean"
FLUX_CHOSEN = "flux_line"  # the variant for FLUX.1-schnell (GHOSTLINES_IMAGE_MODEL=flux)

# Extra words per difficulty, placed right after the subject. Must match Difficulty in types.ts.
DIFFICULTY_HINTS = {
    "simple": "very simple, few lines, minimal detail",
    "medium": "",
    "detailed": "more detail, a few interior lines",
}


def active_variant() -> str:
    """The variant to generate with: GHOSTLINES_PROMPT when it's set (to try another variant on the live server
    without editing code), else CHOSEN (FLUX_CHOSEN when GHOSTLINES_IMAGE_MODEL=flux)."""
    from scripts.download_models import image_model

    default = FLUX_CHOSEN if image_model() == "flux" else CHOSEN
    variant = os.environ.get("GHOSTLINES_PROMPT", "").strip() or default
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


# The prompt for OpenAI's image model (pipeline/openai_images.py), in plain sentences: unlike SDXL-Lightning it reads
# long prompts and follows "no ..." instructions. Asks for what tracing and the lesson need: even outlines, the whole
# subject, nothing else in the picture, no fills or shading (they trace into scribbles).
OPENAI_PROMPT = (
    "A simple black line drawing of {subject}, for a beginner's step-by-step drawing lesson. "
    "Clean, smooth, closed black outlines, all the same medium thickness, on a plain pure white background. "
    "The whole subject is centered and fully in the picture, with white space around it. {detail} "
    "Round and mirror-image parts (faces, eyes, wheels, balls) are drawn smooth and even. "
    "Only the subject: no background, no ground line, no shadows, no shading, no hatching, no texture strokes, "
    "no color, no gray, no solid black areas, no text, no frame or border."
)

# On Oct 13, "medium" drawings came back with 9-25 lines, which build_pack.rate_difficulty labels "simple" (a
# lesson needs 26-50 lines to be "medium"). So medium and detailed ask for the inner lines a lesson can teach.
OPENAI_DETAIL = {
    "simple": "Use as few lines as possible: the outline and the main shapes only.",
    "medium": ("Use a moderate number of lines: the outline, the main shapes, and the inner lines that show how it "
               "is built (eyes, ears, paws, panels, windows, wheels, folds), about 30 to 40 separate lines in all."),
    "detailed": ("Include the outline, the main shapes and the important inner details (features, panels, folds, "
                 "patterns drawn as lines), about 50 separate clean lines in all."),
}


def openai_prompt(subject: str, difficulty: str = "medium") -> str:
    """The OpenAI prompt for one subject, e.g. 'a monkey'."""
    subject = " ".join(subject.split())
    if not subject:
        raise ValueError("subject must not be empty")
    if difficulty not in OPENAI_DETAIL:
        raise ValueError(f"unknown difficulty {difficulty!r}, expected one of {list(OPENAI_DETAIL)}")
    return OPENAI_PROMPT.format(subject=subject, detail=OPENAI_DETAIL[difficulty])
