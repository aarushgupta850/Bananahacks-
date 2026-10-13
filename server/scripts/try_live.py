"""Sends typed prompts to a running live server, the way the site does, and saves what comes back. No GPU needed here.

    python server/scripts/try_live.py <server url> <out dir> "a cat:simple" "a robot:medium" ...

For each prompt it prints how long the lesson took to arrive and how many strokes it has, and saves the lesson's
reference (target.png) and the AI drafts it was chosen from into <out dir>/<prompt>-<difficulty>/, with the
"How this lesson was made" text in pack.json. Requests go one at a time (the server runs one job at a time).
"""

from __future__ import annotations

import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def save_data_url(url: str, path: Path) -> None:
    path.write_bytes(base64.b64decode(url.split(",", 1)[1]))


def try_prompt(server: str, out: Path, prompt: str, difficulty: str) -> dict:
    body = json.dumps({"prompt": prompt, "difficulty": difficulty}).encode()
    request = urllib.request.Request(f"{server.rstrip('/')}/generate", data=body,
                                     headers={"Content-Type": "application/json"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            pack = json.load(response)
    except urllib.error.HTTPError as error:
        return {"prompt": prompt, "difficulty": difficulty, "seconds": round(time.perf_counter() - start, 1),
                "error": f"HTTP {error.code}: {error.read().decode(errors='replace')[:200]}"}
    seconds = time.perf_counter() - start
    folder = out / f"{re.sub(r'[^a-z0-9]+', '-', prompt.lower()).strip('-')}-{difficulty}"
    folder.mkdir(parents=True, exist_ok=True)
    save_data_url(pack["target"], folder / "target.png")
    stages = {s["id"]: s for s in pack["pipeline"]}
    for i, url in enumerate(stages["candidates"]["images"]):
        save_data_url(url, folder / f"candidate-{i}.webp")
    chosen = stages["candidates"]["images"].index(stages["chosen"]["image"])
    lean = {k: v for k, v in pack.items() if k not in ("target", "thumb", "pipeline")}
    lean["pipeline"] = [{k: v for k, v in s.items() if k not in ("image", "images")} for s in pack["pipeline"]]
    (folder / "pack.json").write_text(json.dumps(lean, indent=1))
    strokes = sum(s["tier"] != "construction" for s in pack["strokes"])
    return {"prompt": prompt, "difficulty": difficulty, "seconds": round(seconds, 1), "strokes": strokes,
            "rated": pack["difficulty"], "chosen": chosen, "drafts": len(stages["candidates"]["images"])}


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        sys.exit(__doc__)
    server, out = argv[0], Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for item in argv[2:]:
        prompt, _, difficulty = item.partition(":")
        result = try_prompt(server, out, prompt, difficulty or "medium")
        print(result, flush=True)
        results.append(result)
    (out / "results.json").write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
