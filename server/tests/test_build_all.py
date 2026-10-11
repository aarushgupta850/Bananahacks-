"""Tests for build_all.py, with fake drawings instead of the GPU models."""

import json

import pytest

import build_all
from build_pack import build
from test_build_pack import DEMO_ONLY_INDEX, FAKE_PARTS, blank, cat_drawing


@pytest.fixture
def subjects(tmp_path):
    folder = tmp_path / "subjects"
    folder.mkdir()
    (folder / "index.json").write_text(json.dumps(DEMO_ONLY_INDEX))
    return folder


def fake_build(bad_wordings=()):
    """A build() whose drawings are blank for the given wordings, and a clean cat otherwise."""
    tried = []

    def build_fn(args, subjects_dir):
        tried.append(args.prompt)
        drawing = blank() if args.prompt in bad_wordings else cat_drawing()
        return build(args, generate=lambda seed: [drawing] * 4, detect=lambda image: FAKE_PARTS,
                     subjects_dir=subjects_dir)

    return build_fn, tried


def test_a_failed_wording_falls_through_to_the_next(subjects):
    build_fn, tried = fake_build(bad_wordings={"a simple house"})
    result = build_all.build_one("house", "medium", ["a simple house", "a house"], build_fn, subjects)
    assert tried == ["a simple house", "a house"]
    assert result["pack"] == "house-medium" and result["wording"] == "a house"
    assert result["strokes"] > 0 and result["steps"] > 0 and result["parts"] == ["head", "body"]
    assert (subjects / "house-medium" / "pack.json").is_file()


def test_one_failed_subject_does_not_stop_the_others(subjects, capsys):
    build_fn, tried = fake_build(bad_wordings={"a mug"})
    code = build_all.main(["--only", "mug,cat"], build_fn, subjects)
    assert code == 1  # something failed
    assert tried == ["a cat", "a mug"]  # in PACKS order
    out = capsys.readouterr().out
    assert "| mug-medium | FAILED" in out and "| cat-medium | a cat |" in out
    assert (subjects / "cat-medium").is_dir() and not (subjects / "mug-medium").exists()


def test_unknown_subjects_are_refused():
    with pytest.raises(SystemExit):
        build_all.main(["--only", "dragon"])


def test_main_points_hugging_face_at_the_local_cache_and_stays_offline(subjects, monkeypatch):
    # The first real run downloaded 7 GB into the default cache because HF_HOME was never set.
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    build_fn, tried = fake_build()
    build_all.main(["--only", "cat", "--seed", "7"], build_fn, subjects)
    import os
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert tried == ["a cat"]
