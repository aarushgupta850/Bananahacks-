"""Tests for picking parts from OWLv2's raw output, with made-up scores. No GPU or model needed."""

import json

import numpy as np

from pipeline import parts as parts_module
from pipeline.parts import load_override, select_parts, subject_slug

DRAWING = (100.0, 100.0, 668.0, 668.0)  # x0, y0, x1, y1 around the ink


def run(entries, labels, slug="fox"):
    """entries: (label, score, box) triples; builds the score matrix OWLv2 would return."""
    boxes = np.array([box for _, _, box in entries], dtype=float)
    scores = np.zeros((len(entries), len(labels)))
    for i, (label, score, _) in enumerate(entries):
        scores[i, labels.index(label)] = score
    return select_parts(scores, boxes, labels, slug, DRAWING)


def test_paired_parts_keep_two_boxes_named_left_and_right():
    found = run([("ear", 0.3, (400, 120, 460, 200)), ("ear", 0.25, (200, 120, 260, 200))], ["ear"])
    assert [p["id"] for p in found] == ["ear_left", "ear_right"]
    assert found[0]["label"] == "Left ear"
    assert found[0]["box"] == [200, 120, 60, 80]  # x, y, w, h


def test_near_duplicate_boxes_are_suppressed():
    found = run([("head", 0.4, (200, 100, 400, 300)), ("head", 0.3, (205, 105, 405, 305))], ["head"])
    assert len(found) == 1 and found[0]["id"] == "head"


def test_low_scores_are_dropped():
    assert run([("tail", 0.05, (500, 400, 650, 500))], ["tail"]) == []


def test_a_part_box_around_the_whole_drawing_is_rejected_except_whole_object_parts():
    whole = (100, 100, 668, 668)
    assert run([("head", 0.3, whole)], ["head"], slug="bird") == []  # a bird "head" can't be the whole bird
    assert run([("body", 0.3, whole)], ["body"], slug="bird")[0]["id"] == "body"
    assert run([("head", 0.3, whole)], ["head"], slug="face")[0]["id"] == "head"  # a face IS mostly head


def test_boxes_off_the_drawing_are_rejected():
    assert run([("tail", 0.5, (0, 0, 90, 90))], ["tail"]) == []


def test_only_the_best_box_for_unpaired_parts():
    found = run([("tail", 0.5, (500, 400, 650, 500)), ("tail", 0.3, (150, 150, 250, 250))], ["tail"])
    assert len(found) == 1 and found[0]["box"][0] == 500


def test_subject_slug():
    assert subject_slug("a coffee mug") == "coffee-mug"
    assert subject_slug("fox") == "fox"


def test_override_file_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(parts_module, "OVERRIDES_DIR", tmp_path)
    fixed = [{"id": "head", "label": "Head", "box": [1, 2, 3, 4]}]
    (tmp_path / "fox-medium.parts.json").write_text(json.dumps(fixed))
    assert load_override("fox-medium") == fixed
    assert load_override("cat-medium") is None
    assert load_override(None) is None


def test_side_view_animals_name_their_legs_front_and_back():
    entries = [("head", 0.4, (500, 120, 640, 260)), ("leg", 0.3, (200, 450, 260, 640)), ("leg", 0.3, (520, 450, 580, 640))]
    found = run(entries, ["head", "leg"], slug="cat")
    ids = {p["id"]: p for p in found}
    assert ids["leg_front"]["box"][0] == 520  # nearer the head, which is on the right
    assert ids["leg_back"]["label"] == "Back leg"
    # A face isn't a side view: its pairs stay left and right.
    assert {p["id"] for p in run([("eye", 0.3, (200, 200, 260, 240)), ("eye", 0.3, (400, 200, 460, 240))],
                                 ["eye"], slug="face")} == {"eye_left", "eye_right"}


def test_override_files_are_valid_parts_inside_the_canvas():
    from pipeline.schema import Part

    for path in sorted(parts_module.OVERRIDES_DIR.glob("*.parts.json")):
        parts = parts_module.load_override(path.name.removesuffix(".parts.json"))
        assert parts, path.name
        assert len({p["id"] for p in parts}) == len(parts), f"{path.name}: duplicate part ids"
        for part in parts:
            Part.model_validate(part)
            x, y, w, h = part["box"]
            assert w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= 768 and y + h <= 768, (path.name, part)



def test_subjects_without_part_names_get_top_and_bottom_halves():
    from pipeline.parts import halves

    top, bottom = halves((100.0, 200.0, 500.0, 600.0))
    assert top == {"id": "top", "label": "Top", "box": [100, 200, 400, 200]}
    assert bottom == {"id": "bottom", "label": "Bottom", "box": [100, 400, 400, 200]}
