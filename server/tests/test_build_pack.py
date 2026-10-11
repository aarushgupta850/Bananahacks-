"""Tests for the pack schema and the pack builder, with fake drawings instead of the GPU models."""

import json
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image
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


@pytest.fixture
def subjects(tmp_path):
    folder = tmp_path / "subjects"
    folder.mkdir()
    shutil.copy(DEMO_INDEX, folder / "index.json")
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


def test_choose_takes_the_fewest_strokes_inside_the_gate_and_skips_rejected():
    def c(n, score=10.0):
        return Candidate(None, [[(0, 0), (1, 1)]] * n, score)

    assert choose([c(70), c(12), c(8, 1086.8), c(30)]) == 1  # 8 strokes, but colored
    assert choose([c(5), c(61)]) is None
    assert choose([c(20, 40.0), c(20, 30.0)]) == 1  # a tie goes to the cleaner one


# ---------------------------------------------------------------- index


def test_update_index_merges_without_touching_other_subjects(subjects):
    index = update_index(subjects / "index.json", "fox", "Fox", "simple", "fox-simple")
    index_path = subjects / "index.json"
    index_path.write_text(json.dumps(index))
    index = update_index(index_path, "fox", "Fox", "medium", "fox-medium")
    titles = [s["title"] for s in index["subjects"]]
    assert titles == ["Fox (demo)", "Fox"]  # the demo entry is untouched
    fox = index["subjects"][1]
    assert fox["packs"] == {"simple": "fox-simple", "medium": "fox-medium"}
    assert fox["thumb"] == "fox-medium/thumb.png"  # the medium pack's thumbnail wins


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
