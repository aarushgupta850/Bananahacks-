"""Rewrites target.png and thumb.png of the packs already built, from each pack's chosen AI drawing, cleaned up
(build_pack.clean_drawing). Strokes, steps and parts don't change, so nothing else in the pack needs rebuilding.
No GPU needed. Run from the repo root:  python server/scripts/retarget.py
"""

import json
import sys
from pathlib import Path

from PIL import Image

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from build_pack import SUBJECTS_DIR, clean_drawing  # noqa: E402


def main() -> int:
    for pack_file in sorted(SUBJECTS_DIR.glob("*/pack.json")):
        folder = pack_file.parent
        pack = json.loads(pack_file.read_text(encoding="utf-8"))
        chosen = next((s.get("image") for s in pack["pipeline"] if s["id"] == "chosen"), None)
        if not chosen or not (folder / chosen).exists():
            print(f"{folder.name}: no chosen image, skipped")
            continue
        target = clean_drawing(Image.open(folder / chosen).convert("RGB"))
        target.save(folder / pack["target"], optimize=True)
        target.resize((256, 256), Image.LANCZOS).save(folder / pack["thumb"], optimize=True)
        print(f"{folder.name}: {(folder / pack['target']).stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
