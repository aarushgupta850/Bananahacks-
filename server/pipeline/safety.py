"""Keeps explicit and violent content out of the live server. Two layers:

1. Words: the prompt is normalized (lowercase, leetspeak like "n4k3d" undone, punctuation dropped) and checked
   against a blocklist, both as whole words and, for the most explicit terms, inside other words ("pornhub").
2. Pictures: an uploaded photo, and the drawing chosen for the lesson, are checked with OWLv2 (the open-vocabulary
   detector the pipeline already uses for parts). If it finds nudity or a weapon with enough confidence, the
   request is refused. It is a filter, not a guarantee, so the prompt is also always wrapped in the line-art
   prompt ("minimalist line icon of ..., no shading ..."), which keeps the drawings simple and non-photographic.
"""

from __future__ import annotations

import re

import numpy as np
from PIL import Image

# Whole words that never belong in a drawing lesson for beginners.
BLOCKED_WORDS = {
    "nude", "nudes", "nudity", "naked", "nsfw", "sex", "sexy", "sexual", "porn", "porno", "xxx", "boob", "boobs",
    "breast", "breasts", "nipple", "nipples", "penis", "vagina", "genitals", "butt", "bikini", "lingerie",
    "underwear", "topless", "erotic", "hentai", "fetish", "orgasm", "horny", "stripper", "strip",
    "kill", "killing", "murder", "blood", "bloody", "gore", "corpse", "dead", "suicide", "gun", "guns", "rifle",
    "pistol", "knife", "weapon", "bomb", "explosion", "drug", "drugs", "cocaine", "heroin", "meth",
    "nazi", "swastika", "terrorist", "hitler", "kkk", "hate", "racist",
}
# Matched even inside other words, because they are never innocent ("pornhub", "nudebeach").
BLOCKED_ANYWHERE = {"porn", "nude", "naked", "nsfw", "hentai", "xxx", "boob", "penis", "vagina", "genital", "swastika"}
LEET = str.maketrans({"4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t"})


def blocked_prompt(prompt: str) -> bool:
    """True if the prompt asks for something explicit or violent, even disguised ("n4k3d", "p.o.r.n")."""
    text = prompt.lower().translate(LEET)
    words = re.findall(r"[a-z]+", text)
    joined = "".join(words)
    return any(w in BLOCKED_WORDS for w in words) or any(term in joined for term in BLOCKED_ANYWHERE)


# OWLv2 text queries for the picture check. A picture is refused when one of them scores at least THRESHOLD and
# beats the matching harmless query (so an ordinary person or a kitchen photo isn't refused).
UNSAFE_QUERIES = ["a naked person", "a nude body", "exposed breasts", "genitals", "a gun", "a knife", "blood"]
SAFE_QUERY = "a clothed person"
THRESHOLD = 0.3


class UnsafeContent(Exception):
    """The picture looks explicit or violent."""


def check_picture(image: Image.Image) -> None:
    """Raises UnsafeContent if OWLv2 finds nudity or a weapon in the picture. Needs the GPU."""
    import torch

    from pipeline.parts import owl

    processor, model = owl()
    queries = [*UNSAFE_QUERIES, SAFE_QUERY]
    inputs = processor(text=[queries], images=image.convert("RGB"), return_tensors="pt").to("cuda")
    with torch.no_grad():
        scores = model(**inputs).logits[0].sigmoid().cpu().numpy()  # (boxes, queries)
    best = np.max(scores, axis=0)
    safe = best[-1]
    for query, score in zip(UNSAFE_QUERIES, best[:-1]):
        if score >= THRESHOLD and score > safe:
            raise UnsafeContent(f"{query} ({score:.2f})")
