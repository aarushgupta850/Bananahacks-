"""Finds a drawing's parts (head, ears, tail ...) with OWLv2, as labeled boxes in 768 x 768 space.

OWLv2 is an open-vocabulary detector: give it an image and some text labels, and it scores thousands of
candidate boxes against each label. What the speed test showed (server/SPEEDTEST.md), and how this uses it:
- Labels that name the subject ("fox head") score far higher than plain ones ("head"), so we ask for those.
- Paired parts (ears, eyes, legs ...) keep up to 2 boxes, after non-maximum suppression (NMS) drops boxes
  that mostly overlap a better one.
- A few boxes are badly wrong (a bird "head" box around the whole bird), so a part box may not cover most
  of the drawing, unless it is a whole-object part like the body.
If server/overrides/<packId>.parts.json exists, it is used instead (boxes fixed by hand). If nothing is
found, the result is [] and the lesson simply has no parts.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline import models

OVERRIDES_DIR = Path(__file__).resolve().parents[1] / "overrides"

# Parts to look for per subject. Anything else gets head and body.
PART_LABELS = {
    "fox": ["head", "body", "ear", "eye", "tail", "leg"],
    "cat": ["head", "body", "ear", "eye", "tail", "leg"],
    "face": ["head", "eye", "nose", "mouth", "ear", "hair"],
    "mug": ["body", "handle", "rim"],
    "sneaker": ["sole", "toe", "laces", "heel"],
    "house": ["roof", "wall", "door", "window", "chimney"],
    "bird": ["head", "body", "wing", "tail", "beak", "leg"],
    "fish": ["body", "tail", "fin", "eye", "mouth"],
}
DEFAULT_LABELS = ["head", "body"]
PAIRED = {"ear", "eye", "leg", "wing", "fin", "window"}  # these keep up to 2 boxes
SIDE_VIEW = {"fox", "cat", "bird"}  # drawn from the side, so a pair of legs is front and back, not left and right
WHOLE_OBJECT = {"body", "wall"}  # these may cover most of the drawing (and a face's head)
THRESHOLD = 0.08  # the speed test's fox scored about 0.1 on its head and eyes; cats and mugs 0.15 to 0.7
NMS_IOU = 0.3  # a box overlapping a better one of the same label by more than this is a duplicate
MAX_PART_SHARE = 0.6  # other parts may cover at most this share of the drawing's bounding box

_cache: dict[str, object] = {}


def subject_slug(subject: str) -> str:
    """'a coffee mug' -> 'coffee-mug', 'fox' -> 'fox'."""
    words = subject.lower().split()
    if len(words) > 1 and words[0] in ("a", "an", "the"):
        words = words[1:]
    return "-".join(words)


def _area(box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _intersection(a, b) -> float:
    return _area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def _iou(a, b) -> float:
    inter = _intersection(a, b)
    return inter / (_area(a) + _area(b) - inter or 1.0)


def select_parts(
    scores: np.ndarray, boxes: np.ndarray, labels: list[str], slug: str, drawing_box: tuple[float, ...]
) -> list[dict]:
    """Picks the parts from OWLv2's raw output. No GPU needed, so it is unit tested.

    scores: (boxes, labels) probabilities 0-1. boxes: (boxes, 4) as x0, y0, x1, y1 in pixels.
    drawing_box: x0, y0, x1, y1 around all the ink. Returns Part dicts: {id, label, box: [x, y, w, h]}.
    """
    drawing_area = _area(drawing_box) or 1.0
    parts = []
    for j, label in enumerate(labels):
        may_be_big = label in WHOLE_OBJECT or (slug == "face" and label == "head")
        limit = 2 if label in PAIRED else 1
        kept = []
        for i in np.argsort(-scores[:, j]):
            if scores[i, j] < THRESHOLD or len(kept) == limit:
                break
            box = tuple(float(v) for v in boxes[i])
            if _area(box) == 0 or _intersection(box, drawing_box) < 0.5 * _area(box):
                continue  # mostly off the drawing
            if not may_be_big and _area(box) > MAX_PART_SHARE * drawing_area:
                continue  # e.g. a "head" box around the whole bird
            if any(_iou(box, k) > NMS_IOU for k in kept):
                continue  # a near-duplicate of a better box
            kept.append(box)
        kept.sort(key=lambda b: b[0] + b[2])  # left to right, by box center
        for n, box in enumerate(kept):
            if len(kept) == 2:
                side = "left" if n == 0 else "right"  # as seen in the picture
                part_id, text = f"{label}_{side}", f"{side.capitalize()} {label}"
            else:
                part_id, text = label, label.capitalize()
            x0, y0, x1, y1 = box
            parts.append({"id": part_id, "label": text, "box": [round(x0), round(y0), round(x1 - x0), round(y1 - y0)]})
    if slug in SIDE_VIEW:
        name_legs_front_and_back(parts)
    return parts


def name_legs_front_and_back(parts: list[dict]) -> None:
    """For an animal seen from the side, the leg on the head's side is the front leg."""
    by_id = {p["id"]: p for p in parts}
    head, left, right = by_id.get("head"), by_id.get("leg_left"), by_id.get("leg_right")
    if not (head and left and right):
        return
    head_x = head["box"][0] + head["box"][2] / 2
    left_x = left["box"][0] + left["box"][2] / 2
    right_x = right["box"][0] + right["box"][2] / 2
    front, back = (left, right) if abs(head_x - left_x) < abs(head_x - right_x) else (right, left)
    front.update(id="leg_front", label="Front leg")
    back.update(id="leg_back", label="Back leg")


def load_override(pack_id: str | None) -> list[dict] | None:
    """Hand-fixed parts for a pack, if server/overrides/<packId>.parts.json exists."""
    if not pack_id:
        return None
    path = OVERRIDES_DIR / f"{pack_id}.parts.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def owl():
    """(processor, model) for OWLv2, loaded once. Also used by pipeline/safety.py."""
    if "owl" not in _cache:
        from transformers import Owlv2ForObjectDetection, Owlv2Processor

        _cache["owl"] = (
            Owlv2Processor.from_pretrained(models.OWL_REPO),
            Owlv2ForObjectDetection.from_pretrained(models.OWL_REPO).to("cuda").eval(),
        )
    return _cache["owl"]


def detect_parts(image: Image.Image, subject: str, pack_id: str | None = None) -> list[dict]:
    """The parts of a 768 x 768 drawing of `subject`. Uses the override file for pack_id if there is one."""
    override = load_override(pack_id)
    if override is not None:
        return override
    import torch

    from pipeline.trace import ink_mask

    ink = ink_mask(image)
    if not ink.any():
        return []
    ys, xs = np.nonzero(ink)
    drawing_box = (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))

    processor, model = owl()
    slug = subject_slug(subject)
    labels = PART_LABELS.get(slug, DEFAULT_LABELS)
    queries = [f"{slug} {label}" for label in labels]
    inputs = processor(text=[queries], images=image.convert("RGB"), return_tensors="pt").to("cuda")
    with torch.no_grad():
        outputs = model(**inputs)
    scores = outputs.logits[0].sigmoid().cpu().numpy()  # (boxes, labels)
    # Boxes come as normalized (cx, cy, w, h) on a square image, which ours is.
    cx, cy, w, h = (outputs.pred_boxes[0].cpu().numpy() * image.width).T
    boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    return select_parts(scores, boxes, labels, slug, drawing_box)
