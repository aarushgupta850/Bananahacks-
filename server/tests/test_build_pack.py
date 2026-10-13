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


def test_choose_prefers_a_whole_subject_then_one_that_fits_the_lesson_as_drawn():
    def c(n, score=10.0, cut_off=False):
        return Candidate(None, [[(0, 0), (1, 1)]] * n, score, cut_off)

    # The cleanest draft runs off the edge, so the next one wins.
    assert choose([c(20, 5.0, cut_off=True), c(22, 9.0)]) == 1
    # For a simple lesson (25 strokes), a clean 40-stroke draft would lose 15 lines; a 22-stroke one keeps all.
    assert choose([c(40, 5.0), c(22, 9.0)], limit=25) == 1
    assert choose([c(40, 5.0), c(22, 9.0)]) == 0  # with the usual limit both fit, so the cleanest wins
    # But a crisp draft just over the limit (it loses 4 short lines of 54) beats a faint, sketchy one that fits.
    assert choose([c(54, 33.5), c(48, 86.0)], limit=50) == 0


def test_choose_anyway_and_simplify_keep_the_big_lines():
    from build_pack import choose_anyway, simplify

    def c(n, score=10.0):
        return Candidate(None, [[(0, 0), (1, 1)]] * n, score)

    assert choose_anyway([c(3, 1.0), c(140, 80.0), c(90, 50.0)]) == 2  # enough lines, and the fewest
    assert choose_anyway([c(100, 10.0), c(70, 50.0)]) == 1  # 70 strokes lose less to simplifying than 100
    assert choose_anyway([c(73, 489.2), c(82, 131.1)]) == 1  # nearly as few strokes, and far cleaner
    assert choose_anyway([c(70, 1050.0), c(90, 50.0)]) == 1  # a colored drawing only if nothing else
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


def test_without_strokes_paints_out_the_dropped_lines_and_keeps_the_rest():
    from build_pack import without_strokes

    drawing = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(drawing)
    draw.line([(100, 200), (600, 200)], fill=INK, width=9)    # kept
    draw.line([(350, 200), (350, 600)], fill=INK, width=9)    # dropped: it meets the kept line at (350, 200)
    out = np.asarray(without_strokes(drawing, kept=[[(100, 200), (600, 200)]],
                                     dropped=[[(350, 200), (350, 600)]]).convert("L"))
    assert (out[197:204, 100:600] < 128).mean() > 0.95   # the kept line is untouched, junction included
    assert (out[215:600, 340:361] < 128).sum() == 0      # the dropped line is gone
    assert abs(int(out[400, 350]) - 220) <= 1            # painted in the page's own gray


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
    # The reference shows only the kept strokes (the others are painted out): far less ink than 90 lines.
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


def test_fit_to_page_scales_a_small_subject_up_to_fill_the_page():
    from pipeline.frame import FIT_MARGIN, fit_to_page

    small = Image.new("RGB", (768, 768), (225, 225, 225))
    ImageDraw.Draw(small).rectangle((300, 500, 450, 600), outline=INK, width=6)  # 150 x 100, low on the page
    ink = np.asarray(fit_to_page(small).convert("L")) < 128
    rows, cols = np.nonzero(ink.any(axis=1))[0], np.nonzero(ink.any(axis=0))[0]
    assert cols[-1] - cols[0] > 1.7 * 150                    # scaled up (at most 1.8x: more would blur the lines)
    assert abs((cols[0] + cols[-1]) / 2 - 384) < 4 and abs((rows[0] + rows[-1]) / 2 - 384) < 4  # centered
    big = Image.new("RGB", (768, 768), (225, 225, 225))
    ImageDraw.Draw(big).rectangle((40, 60, 720, 700), outline=INK, width=6)
    assert fit_to_page(big) is big                           # already fills the page
    assert FIT_MARGIN < 0.1


def test_simplify_keeps_the_features_inside_detail_parts():
    from build_pack import simplify

    outline = [(100.0, 100.0), (600.0, 100.0), (600.0, 600.0)]   # 1000 px: always kept
    fur = [(150.0, 500.0), (150.0, 550.0)]                       # 50 px, outside the head
    nose = [(300.0, 300.0), (330.0, 300.0)]                      # 30 px, inside the head
    head = [250, 250, 150, 150]
    assert simplify([outline, fur, nose], 2) == [outline, fur]   # by length alone the nose would go...
    assert simplify([outline, fur, nose], 2, [head]) == [outline, nose]  # ...but inside the head it counts more


def test_without_strokes_keeps_a_short_piece_joining_two_kept_lines():
    from build_pack import without_strokes

    drawing = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(drawing)
    draw.line([(100, 300), (300, 300)], fill=INK, width=9)    # kept
    draw.line([(330, 300), (600, 300)], fill=INK, width=9)    # kept
    draw.line([(300, 300), (330, 300)], fill=INK, width=9)    # dropped, but it joins the two (a knee)
    out = np.asarray(without_strokes(drawing, kept=[[(100, 300), (300, 300)], [(330, 300), (600, 300)]],
                                     dropped=[[(300, 300), (330, 300)]]).convert("L"))
    assert (out[298:303, 300:331] < 128).all()               # no gap in the line


def test_the_live_server_prefers_a_whole_subject_over_a_cut_off_one_that_fits():
    from build_pack import make_pack

    cropped = Image.new("RGB", (768, 768), (220, 220, 220))
    cropped.paste(cat_drawing().crop((0, 0, 768, 618)), (0, 150))  # the cat moved down: its legs run off the page
    whole = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(whole)
    for k in range(90):  # 90 separate short lines, none near the edge: whole, but over the 60-stroke gate
        x, y = 40 + (k % 10) * 70, 40 + (k // 10) * 75
        draw.line([(x, y), (x + 30 + k % 7 * 3, y + 20)], fill=INK, width=6)
    lines = []
    pack, _ = make_pack(pack_id="live-cat-simple", subject="cat", title="Cat", difficulty="simple",
                        source_kind="prompt", prompt="cat", subject_words="cat", seed=0,
                        generate=lambda seed: [cropped, whole], detect=lambda image: [], retries=0, log=lines.append,
                        always=True, rate=True, limit=25)
    assert pack["pipeline"][2]["image"].endswith("candidate-1.webp")  # the whole one, simplified to 25 strokes
    assert any("cut off" in line for line in lines) and any("whole subject" in line for line in lines)


def test_without_strokes_keeps_dropped_lines_inside_protected_parts():
    from build_pack import without_strokes

    drawing = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(drawing)
    draw.line([(100, 600), (600, 600)], fill=INK, width=9)    # kept
    draw.line([(300, 300), (330, 300)], fill=INK, width=9)    # dropped: a nose, inside the head
    out = np.asarray(without_strokes(drawing, kept=[[(100, 600), (600, 600)]], dropped=[[(300, 300), (330, 300)]],
                                     protect=[[250, 250, 150, 150]]).convert("L"))
    assert (out[298:303, 300:331] < 128).all()               # the nose stays on the reference


def test_clean_drawing_turns_gray_fills_and_halos_white_and_keeps_lines_black():
    from build_pack import clean_drawing

    drawing = Image.new("RGB", (768, 768), (228, 228, 228))
    draw = ImageDraw.Draw(drawing)
    draw.ellipse((150, 150, 618, 618), fill=(205, 205, 205))             # a pale disc behind the subject
    draw.rectangle((300, 300, 470, 470), fill=(170, 170, 170), outline=(25, 25, 25), width=8)  # gray-filled box
    out = np.asarray(clean_drawing(drawing))
    assert out[385, 385] == 255 and out[200, 384] == 255 and out[150, 384] == 255  # fill, disc and its edge: white
    assert out[303, 385] < 60                                            # the outline stays black


def test_lesson_only_keeps_what_the_lesson_shows_and_erases_the_rest():
    from build_pack import lesson_only

    drawing = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(drawing)
    outline = [(150, 150), (600, 150), (600, 600), (150, 600), (150, 150)]
    draw.line(outline, fill=INK, width=9)                                  # taught
    draw.rectangle((300, 250, 340, 500), fill=INK)                         # a solid black bar: taught by its rim
    bar_rim = [(304, 254), (336, 254), (336, 496), (304, 496), (304, 254)]
    draw.ellipse((400, 290, 440, 310), fill=(150, 150, 150))               # an eye drawn as a gray almond
    almond = [(400 + 20 + 20 * np.cos(a), 300 + 10 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 16)]
    draw.ellipse((442, 392, 458, 408), fill=INK)                           # a solid dot eye
    dot = [(450 + 4 * np.cos(a), 400 + 4 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 12)]
    draw.line([(200, 650), (550, 650)], fill=(150, 150, 150), width=5)     # a faint sketch line: not taught
    draw.line([(650, 100), (690, 100)], fill=INK, width=6)                 # a separate scrap: not taught
    out = np.asarray(lesson_only(drawing, [outline, bar_rim, almond, dot]).convert("L"))
    assert (out[146:155, 150:600] < 128).mean() > 0.95                     # the outline stays
    assert (out[260:490, 310:330] < 128).all()                             # the whole bar stays black
    assert out[300, 420] < 170 and out[400, 450] < 128                     # both eyes stay
    assert (out[640:660, 200:550] < 200).sum() == 0                        # the faint line is gone...
    assert (out[90:110, 645:695] < 200).sum() == 0                         # ...and so is the scrap
    assert abs(int(out[650, 300]) - 220) <= 1                              # painted in the page's own gray
    clean = Image.new("RGB", (768, 768), (220, 220, 220))
    ImageDraw.Draw(clean).line(outline, fill=INK, width=9)
    assert lesson_only(clean, [outline]) is clean                          # nothing to erase: unchanged


def test_simplify_keeps_the_whole_outline_of_a_busy_drawing():
    from build_pack import outline_band, simplify

    drawing = Image.new("RGB", (768, 768), (220, 220, 220))
    draw = ImageDraw.Draw(drawing)
    corners = [(150, 150), (600, 150), (600, 600), (150, 600), (150, 150)]
    outline = []  # the square's outline as 8 strokes of 225 px
    for (x1, y1), (x2, y2) in zip(corners, corners[1:]):
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        outline += [[(x1, y1), (mx, my)], [(mx, my), (x2, y2)]]
    texture = [[(220 + 60 * k, 250), (220 + 60 * k, 500)] for k in range(6)]  # 6 inner lines of 250 px
    for stroke in outline + texture:
        draw.line(stroke, fill=INK, width=8)
    strokes = outline + texture
    by_length = simplify(strokes, 8)
    assert sum(s in outline for s in by_length) == 2               # by length alone the outline would break...
    kept = simplify(strokes, 8, outline=outline_band(drawing))
    assert all(s in kept for s in outline)                         # ...but along the outer edge it counts more
