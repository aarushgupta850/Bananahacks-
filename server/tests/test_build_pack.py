import io
"""Tests for the pack schema and the pack builder, with fake drawings instead of the GPU models."""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError

import build_pack
from build_pack import Candidate, build, choose, parse_args, update_index
from pipeline import schema

REPO = Path(__file__).resolve().parents[2]
DEMO_PACK = REPO / "web" / "public" / "subjects" / "demo-fox-medium" / "pack.json"
DEMO_INDEX = REPO / "web" / "public" / "subjects" / "index.json"
INK = (25, 25, 25)


def cat_drawing(legs: int = 4) -> Image.Image:
    """A simple cartoon cat on a light gray page, like the generated drawings."""
    c = np.full((768, 768, 3), 220, np.uint8)
    aa = cv2.LINE_AA
    cv2.ellipse(c, (400, 470), (170, 110), 0, 0, 360, INK, 12, aa)
    cv2.circle(c, (250, 300), 95, INK, 12, aa)
    cv2.polylines(c, [np.array([(190, 225), (205, 130), (255, 205)])], False, INK, 12, aa)
    cv2.polylines(c, [np.array([(265, 205), (320, 125), (325, 225)])], False, INK, 12, aa)
    cv2.circle(c, (225, 290), 10, INK, -1, aa)
    cv2.circle(c, (285, 290), 10, INK, -1, aa)
    cv2.ellipse(c, (600, 380), (90, 50), -30, 180, 360, INK, 12, aa)
    for x in (300, 360, 450, 510)[:legs]:
        cv2.line(c, (x, 585), (x, 660), INK, 12, aa)
    return Image.fromarray(c)


def blank() -> Image.Image:
    return Image.new("RGB", (768, 768), (220, 220, 220))


FAKE_PARTS = [{"id": "head", "label": "Head", "box": [150, 200, 200, 200]},
              {"id": "body", "label": "Body", "box": [225, 355, 350, 230]}]


# A fixed one-subject index, so these tests don't depend on whichever packs the real index.json lists.
DEMO_ONLY_INDEX = {"subjects": [{"subject": "fox", "title": "Fox (demo)", "thumb": "demo-fox-medium/thumb.svg",
                                 "packs": {"medium": "demo-fox-medium"}}]}


@pytest.fixture
def subjects(tmp_path):
    folder = tmp_path / "subjects"
    folder.mkdir()
    (folder / "index.json").write_text(json.dumps(DEMO_ONLY_INDEX))
    return folder


# ---------------------------------------------------------------- schema


def test_schema_accepts_the_demo_pack():
    schema.Pack.model_validate(json.loads(DEMO_PACK.read_text()))
    schema.SubjectIndex.model_validate(json.loads(DEMO_INDEX.read_text()))


def test_schema_rejects_unknown_fields_and_broken_references():
    pack = json.loads(DEMO_PACK.read_text())
    with pytest.raises(ValidationError):
        schema.Pack.model_validate({**pack, "extra": 1})
    broken = json.loads(DEMO_PACK.read_text())
    broken["strokes"][0]["partId"] = "no-such-part"
    with pytest.raises(ValidationError):
        schema.Pack.model_validate(broken)
    broken = json.loads(DEMO_PACK.read_text())
    broken["steps"][0]["strokeIds"].append("no-such-stroke")
    with pytest.raises(ValidationError):
        schema.Pack.model_validate(broken)


# ---------------------------------------------------------------- choosing


def test_choose_takes_the_cleanest_inside_the_gate_and_skips_rejected():
    def c(n, score=10.0):
        return Candidate(None, [[(0, 0), (1, 1)]] * n, score)

    assert choose([c(70), c(12, 30.0), c(8, 1086.8), c(30, 20.0)]) == 3  # cleanest; the 8-stroke one is colored
    assert choose([c(5), c(61)]) is None
    assert choose([c(20, 30.0), c(12, 30.0)]) == 1  # a tie goes to fewer strokes


def test_choose_anyway_and_simplify_keep_the_big_lines():
    from build_pack import choose_anyway, simplify

    def c(n, score=10.0):
        return Candidate(None, [[(0, 0), (1, 1)]] * n, score)

    assert choose_anyway([c(3, 1.0), c(140, 80.0), c(90, 50.0)]) == 2  # cleanest with enough lines
    assert choose_anyway([c(0, 1000.0)]) is None  # blank
    strokes = [[(0, 0), (k, 0)] for k in range(1, 101)]  # lengths 1..100
    kept = simplify(strokes, limit=60)
    assert len(kept) == 60 and kept[0] == [(0, 0), (41, 0)] and kept[-1] == [(0, 0), (100, 0)]  # order kept


# ---------------------------------------------------------------- index


def test_update_index_merges_without_touching_other_subjects(subjects):
    index_path = subjects / "index.json"
    index = update_index(index_path, "cat", "Cat", "medium", "cat-medium")
    index_path.write_text(json.dumps(index))
    index = update_index(index_path, "fox", "Fox", "simple", "fox-simple")
    index_path.write_text(json.dumps(index))
    index = update_index(index_path, "fox", "Fox", "medium", "fox-medium")
    # One entry per subject (the app keys subject cards by it); the real fox replaces the demo fox.
    assert [s["subject"] for s in index["subjects"]] == ["fox", "cat"]
    fox = index["subjects"][0]
    assert fox["title"] == "Fox"
    assert fox["packs"] == {"simple": "fox-simple", "medium": "fox-medium"}
    assert fox["thumb"] == "fox-medium/thumb.png"  # the medium pack's thumbnail wins
    assert index["subjects"][1]["packs"] == {"medium": "cat-medium"}  # the other subject is untouched


def test_render_target_smooths_curves_but_keeps_the_ends():
    from build_pack import smooth

    line = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)]
    out = smooth(line)
    assert out[0] == line[0] and out[-1] == line[-1]
    assert len(out) > len(line)
    loop = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 0.0)]
    assert smooth(loop)[0] == smooth(loop)[-1]  # a closed stroke stays closed


# ---------------------------------------------------------------- the whole build


def test_build_writes_a_valid_pack(subjects):
    args = parse_args(["--subject", "cat", "--difficulty", "medium", "--prompt", "a cat"])
    seeds = []

    def fake_generate(seed):
        seeds.append(seed)
        return [blank(), cat_drawing(4), cat_drawing(3), blank()]

    folder = build(args, generate=fake_generate, detect=lambda image: FAKE_PARTS, subjects_dir=subjects)
    assert folder == subjects / "cat-medium"
    assert seeds == [0]  # no retry needed
    pack = json.loads((folder / "pack.json").read_text())
    schema.Pack.model_validate(pack)
    assert pack["id"] == "cat-medium" and pack["title"] == "Cat"
    assert pack["source"] == {"kind": "prompt", "prompt": "a cat"}
    assert [s["id"] for s in pack["pipeline"]] == ["source", "candidates", "chosen", "skeleton", "parts", "order"]
    stages = {s["id"]: s for s in pack["pipeline"]}
    assert stages["chosen"]["image"] in stages["candidates"]["images"]
    assert stages["chosen"]["image"] == "pipeline/candidate-2.webp"  # the 3-legged cat has fewer strokes
    for name in ["target.png", "thumb.png", *[f"pipeline/candidate-{i}.webp" for i in range(4)],
                 "pipeline/skeleton.webp", "pipeline/parts.webp"]:
        assert (folder / name).is_file(), name
    for image in (folder / "pipeline").iterdir():
        assert image.stat().st_size <= 300 * 1024
    assert Image.open(folder / "target.png").size == (768, 768)
    assert Image.open(folder / "thumb.png").size == (256, 256)
    assert pack["strokes"][0]["id"] == "c-head"  # construction first
    index = json.loads((subjects / "index.json").read_text())
    assert {"subject": "cat", "title": "Cat", "thumb": "cat-medium/thumb.png",
            "packs": {"medium": "cat-medium"}} in index["subjects"]


def test_build_retries_once_with_new_seeds(subjects):
    args = parse_args(["--subject", "cat", "--difficulty", "medium", "--prompt", "a cat", "--seed", "5"])
    seeds = []

    def fake_generate(seed):
        seeds.append(seed)
        return [blank()] * 4 if seed == 5 else [cat_drawing()] * 4

    build(args, generate=fake_generate, detect=lambda image: [], subjects_dir=subjects)
    assert seeds == [5, 5 + build_pack.RETRY_SEED_OFFSET]


def test_build_stops_with_a_clear_message_when_nothing_fits(subjects):
    args = parse_args(["--subject", "cat", "--difficulty", "medium", "--prompt", "a cat"])
    with pytest.raises(SystemExit, match="No candidate had 6-60 strokes"):
        build(args, generate=lambda seed: [blank()] * 4, detect=lambda image: [], subjects_dir=subjects)
    assert not (subjects / "cat-medium").exists()  # nothing written


def test_subject_must_be_a_safe_folder_name():
    with pytest.raises(SystemExit):
        parse_args(["--subject", "../evil", "--difficulty", "medium", "--prompt", "x"])


def test_always_builds_a_pack_from_a_busy_drawing_and_runs_the_safety_check():
    from build_pack import make_pack

    busy = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(busy)
    for k in range(90):  # 90 separate short lines: over the 60-stroke gate
        x, y = 40 + (k % 10) * 70, 40 + (k // 10) * 75
        draw.line([(x, y), (x + 30 + k % 7 * 3, y + 20)], fill=INK, width=6)
    checked = []
    common = dict(pack_id="live-busy-medium", subject="busy", title="Busy", difficulty="medium", source_kind="prompt",
                  prompt="busy", subject_words="busy", seed=0, generate=lambda seed: [busy] * 3,
                  detect=lambda image: [], retries=0, log=lambda *a: None)
    with pytest.raises(build_pack.NoCleanCandidate):
        make_pack(**common)
    pack, _ = make_pack(**common, always=True, check_drawing=checked.append)
    schema.Pack.model_validate(pack)
    assert len([s for s in pack["strokes"] if s["tier"] != "construction"]) <= 60
    assert len(checked) == 1
    assert pack["difficulty"] == "medium"  # without rate=True the pack keeps the difficulty it was asked for

    # The live server rates the drawing instead: 90 strokes is far past medium, whatever the user picked.
    rated, _ = make_pack(**common, always=True, rate=True)
    assert rated["difficulty"] == "detailed"
    assert "traced into 90 strokes" in {s["id"]: s for s in rated["pipeline"]}["chosen"]["text"]


def test_rate_difficulty_counts_the_strokes_the_user_has_to_draw():
    from build_pack import rate_difficulty

    assert [rate_difficulty(n) for n in (6, 25, 26, 50, 51, 140)] == [
        "simple", "simple", "medium", "medium", "detailed", "detailed"]


def test_a_simple_lesson_keeps_few_strokes_and_its_reference_shows_just_those():
    from build_pack import make_pack

    busy = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(busy)
    for k in range(90):  # 90 separate short lines
        x, y = 40 + (k % 10) * 70, 40 + (k // 10) * 75
        draw.line([(x, y), (x + 30 + k % 7 * 3, y + 20)], fill=INK, width=6)
    pack, assets = make_pack(pack_id="live-busy-simple", subject="busy", title="Busy", difficulty="simple",
                             source_kind="prompt", prompt="busy", subject_words="busy", seed=0,
                             generate=lambda seed: [busy] * 3, detect=lambda image: [], retries=0,
                             log=lambda *a: None, always=True, rate=True, limit=25)
    assert len([s for s in pack["strokes"] if s["tier"] != "construction"]) <= 25
    assert pack["difficulty"] == "simple"
    # The reference is drawn from the kept strokes: far less ink than the 90-line picture.
    ink = (np.asarray(Image.open(io.BytesIO(assets["target.png"])).convert("L")) < 128).mean()
    original = (np.asarray(busy.convert("L")) < 128).mean()
    assert ink < 0.5 * original


def test_a_rated_pack_with_few_strokes_says_simple_even_when_detailed_was_asked_for():
    from build_pack import make_pack

    pack, _ = make_pack(pack_id="live-cat-detailed", subject="cat", title="Cat", difficulty="detailed",
                        source_kind="prompt", prompt="a cat", subject_words="a cat", seed=0,
                        generate=lambda seed: [cat_drawing()] * 3, detect=lambda image: FAKE_PARTS, retries=0,
                        log=lambda *a: None, always=True, rate=True)
    assert pack["difficulty"] == "simple"  # the fake cat is a handful of strokes
    assert "more detail" in {s["id"]: s for s in pack["pipeline"]}["source"]["text"]  # the prompt still asked for it


def test_clean_drawing_whitens_an_uneven_page_and_keeps_the_ink_black():
    import numpy as np

    from build_pack import clean_drawing

    page = np.tile(np.linspace(170, 235, 768, dtype=np.float32), (768, 1))  # unevenly lit gray page
    page[380:388, 100:700] = 30  # one ink line
    out = np.asarray(clean_drawing(Image.fromarray(page.astype(np.uint8)).convert("RGB")))
    assert out.shape == (768, 768)
    assert out[100, 50] == 255 and out[100, 700] == 255  # the page is white on both the dark and the light side
    assert out[384, 400] < 40  # the ink stays black


def test_a_higher_stroke_minimum_refuses_a_drawing_of_a_few_fragments():
    from build_pack import make_pack

    common = dict(pack_id="live-photo-medium", subject="photo", title="Your photo", difficulty="medium",
                  source_kind="photo", prompt=None, subject_words="the object in the photo", seed=0,
                  generate=lambda seed: [cat_drawing()] * 2, detect=lambda image: FAKE_PARTS, retries=0,
                  log=lambda *a: None)
    make_pack(**common)  # a handful of strokes passes the usual gate of 6...
    with pytest.raises(build_pack.NoCleanCandidate, match="No candidate had 40-60"):
        make_pack(**common, min_strokes=40)  # ...but not a photo's higher minimum
