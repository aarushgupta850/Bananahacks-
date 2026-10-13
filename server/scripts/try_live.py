"""Sends typed prompts to a running live server, the way the site does, and saves what comes back. No GPU needed here.

    python server/scripts/try_live.py <server url> <out dir> "a cat:simple" "a robot:medium" ...
    python server/scripts/try_live.py <server url> <out dir> "photo=C:/photos/mug.jpg:medium"

For each prompt it prints how long the lesson took to arrive and how many strokes it has, and saves the lesson's
reference (target.png) and the AI drafts it was chosen from into <out dir>/<prompt>-<difficulty>/, with the
"How this lesson was made" text in pack.json. Requests go one at a time: the server runs one job at a time, and a
job that timed out keeps the GPU until it really ends, so on "busy" (503) it waits for /health to say it's free.
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


def wait_until_free(server: str, limit_s: float = 120) -> None:
    """Waits until the server's /health says it isn't busy (or limit_s passes)."""
    end = time.monotonic() + limit_s
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(f"{server.rstrip('/')}/health", timeout=10) as response:
                if not json.load(response).get("busy"):
                    return
        except (urllib.error.URLError, OSError, ValueError):
            pass
        time.sleep(2)


def try_prompt(server: str, out: Path, prompt: str, difficulty: str) -> dict:
    """One lesson. A prompt of the form "photo=<path>" sends that photo instead, as the site does (base64)."""
    if prompt.startswith("photo="):
        photo = Path(prompt[len("photo="):])
        payload = {"imageBase64": base64.b64encode(photo.read_bytes()).decode(), "difficulty": difficulty}
        prompt = f"photo {photo.stem}"
    else:
        payload = {"prompt": prompt, "difficulty": difficulty}
    body = json.dumps(payload).encode()
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


def split_item(item: str) -> tuple[str, str]:
    """("a cat", "simple") from "a cat:simple"; a missing or unknown difficulty means medium. Only the last ":"
    counts, so a Windows photo path ("photo=C:/photos/mug.jpg:simple") keeps its drive letter."""
    head, _, tail = item.rpartition(":")
    return (head, tail) if head and tail in ("simple", "medium", "detailed") else (item, "medium")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        sys.exit(__doc__)
    server, out = argv[0], Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for item in argv[2:]:
        prompt, difficulty = split_item(item)
        wait_until_free(server)
        result = try_prompt(server, out, prompt, difficulty)
        if "HTTP 503" in result.get("error", ""):  # someone else's job started first: wait for it, then try again
            wait_until_free(server)
            result = try_prompt(server, out, prompt, difficulty)
        print(result, flush=True)
        results.append(result)
    (out / "results.json").write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
