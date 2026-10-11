"""The text prompt for the text-to-line-art path (SDXL-Lightning, 4 steps, guidance 0).

With guidance 0 the model ignores negative prompts, so everything we want (and don't want) has to be
said in the positive prompt. scripts/speedtest.py generates every variant below, scores how clean the
lines are, and the cleanest one becomes CHOSEN.

Keep each prompt short: SDXL's text encoders read at most 77 tokens and silently drop the rest.
"""

VARIANTS = {
    # The first prompt we tried. It gave a detailed, hatched fox portrait with a decorative frame.
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
    # Icon style tends to give bold, uniform, closed outlines.
    "icon": (
        "minimalist line icon of {subject}, whole body, bold uniform black outline, flat, "
        "very few lines, no details, no shading, no fill, isolated on plain white background"
    ),
}

# The variant the pipeline uses. Set from the speed test results (see server/SPEEDTEST.md).
CHOSEN = "baseline"


def line_art_prompt(subject: str, variant: str = CHOSEN) -> str:
    """Builds the generation prompt for one subject, e.g. 'a fox' or 'a coffee mug'."""
    subject = " ".join(subject.split())  # collapse stray spaces and newlines
    if not subject:
        raise ValueError("subject must not be empty")
    if variant not in VARIANTS:
        raise ValueError(f"unknown prompt variant {variant!r}, expected one of {sorted(VARIANTS)}")
    return VARIANTS[variant].format(subject=subject)
