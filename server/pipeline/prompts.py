"""The text prompt for the text-to-line-art path (SDXL-Lightning, 4 steps, guidance 0).

With guidance 0 there is no negative prompt, so everything we want (and don't want) has to be said
in the positive prompt: black outlines only, white background, no shading or color. That gives the
stroke extractor clean lines to trace.
"""

LINE_ART_TEMPLATE = (
    "simple black ink line drawing of {subject}, clean continuous outlines, "
    "minimal line art, coloring book page, plain white background, "
    "no shading, no color, no texture, centered, full view"
)


def line_art_prompt(subject: str) -> str:
    """Builds the generation prompt for one subject, e.g. 'a fox' or 'a coffee mug'."""
    subject = " ".join(subject.split())  # collapse stray spaces and newlines
    if not subject:
        raise ValueError("subject must not be empty")
    return LINE_ART_TEMPLATE.format(subject=subject)
