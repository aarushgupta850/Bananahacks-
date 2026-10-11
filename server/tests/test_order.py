"""Tests for the lesson planner (tiers, order, parts, steps, key points). No GPU needed."""

import math

from pipeline.order import build_plan, key_points, part_of


def circle(cx, cy, r, n=64):
    pts = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    return pts + pts[:1]


HEAD = {"id": "head", "label": "Head", "box": [284, 100, 200, 200]}
BODY = {"id": "body", "label": "Body", "box": [234, 300, 300, 380]}
EYE = {"id": "eye_left", "label": "Left eye", "box": [330, 170, 40, 40]}


def fox_like():
    head = circle(384, 200, 100)
    body = circle(384, 490, 150)
    spine = [(384, 380), (384, 600)]  # a long line inside the body
    whisker = [(300, 230), (320, 232)]  # a short line inside the head
    eye = circle(350, 190, 12, n=12)
    return [eye, whisker, spine, body, head]  # deliberately not in drawing order


def test_construction_comes_first_head_then_body():
    plan = build_plan(fox_like(), [HEAD, BODY, EYE])
    first, second = plan["strokes"][:2]
    assert (first["id"], second["id"]) == ("c-head", "c-body")
    assert first["tier"] == second["tier"] == "construction"
    assert len(first["points"]) == 49 and first["points"][0] == first["points"][-1]


def test_tiers_outline_structure_detail():
    plan = build_plan(fox_like(), [HEAD, BODY, EYE])
    tiers = {len(s["points"]): s["tier"] for s in plan["strokes"] if s["tier"] != "construction"}
    by_tier = [s["tier"] for s in plan["strokes"]]
    assert by_tier == sorted(by_tier, key=["construction", "outline", "structure", "detail"].index)
    outlines = [s for s in plan["strokes"] if s["tier"] == "outline"]
    assert len(outlines) == 2  # the head and body circles make up the silhouette
    spine = next(s for s in plan["strokes"] if s["points"] == [[384, 380], [384, 600]])
    whisker = next(s for s in plan["strokes"] if s["points"] == [[300, 230], [320, 232]])
    assert spine["tier"] == "structure"
    assert whisker["tier"] == "detail"
    assert tiers  # sanity


def test_center_outward_within_a_tier():
    plan = build_plan(fox_like(), [])
    outlines = [s for s in plan["strokes"] if s["tier"] == "outline"]
    # The body circle's center is closer to the drawing's center than the head's.
    assert outlines[0]["points"][0][1] > outlines[1]["points"][0][1]


def test_part_assignment_prefers_the_smallest_box():
    eye = circle(350, 190, 12, n=12)
    assert part_of(eye, [HEAD, EYE]) == "eye_left"
    assert part_of(circle(384, 490, 150), [HEAD, BODY]) == "body"
    assert part_of([(10, 10), (40, 10)], [HEAD, BODY]) is None


def test_steps_group_up_to_four_strokes_with_the_same_tier_and_part():
    strokes = [[(300 + 10 * i, 400), (300 + 10 * i, 405)] for i in range(6)]  # 6 tiny details in the body
    strokes.append(circle(384, 490, 150))
    plan = build_plan(strokes, [BODY])
    steps = plan["steps"]
    for step in steps:
        assert 1 <= len(step["strokeIds"]) <= 4
        tiers = {s["tier"] for s in plan["strokes"] if s["id"] in step["strokeIds"]}
        assert tiers == {step["tier"]}
    detail_steps = [s for s in steps if s["tier"] == "detail"]
    assert [len(s["strokeIds"]) for s in detail_steps] == [4, 2]
    assert all(s["label"] == "Add the body" for s in detail_steps)
    assert "about" in detail_steps[0]["tip"] and "% of the drawing height" in detail_steps[0]["tip"]
    # Every stroke appears in exactly one step, in order.
    ids = [i for s in steps for i in s["strokeIds"]]
    assert ids == [s["id"] for s in plan["strokes"]]


def test_step_labels_without_parts_are_generic():
    plan = build_plan([circle(384, 384, 200)], [])
    assert plan["steps"][0]["label"] == "Outline the shape"


def test_key_points_ends_corners_and_loops():
    line = [(100, 100), (300, 100)]
    assert key_points(line) == [(100, 100), (300, 100)]
    corner = [(100, 100), (100, 400), (400, 400)]
    assert (100, 400) in key_points(corner)
    loop = key_points(circle(384, 384, 100))
    assert len(loop) == 4  # top, right, bottom, left
    assert (384, 284) in loop and (484, 384) in loop


def test_ids_are_unique_and_points_are_whole_numbers():
    plan = build_plan(fox_like(), [HEAD, BODY])
    ids = [s["id"] for s in plan["strokes"]]
    assert len(ids) == len(set(ids))
    for s in plan["strokes"]:
        assert all(isinstance(v, int) for p in s["points"] + s["keyPoints"] for v in p)


def test_empty_drawing_gives_an_empty_plan():
    assert build_plan([], [HEAD]) == {"strokes": [], "steps": []}
