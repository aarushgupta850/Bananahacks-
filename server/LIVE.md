# Live generation server

The site works fully without this server: it shows ready-made subjects and a friendly "offline" note.
When the server is running and reachable, "Make your own" on the subject picker turns on, and anyone on the
live site can type a short prompt (or upload a photo) and get a fresh lesson in about 15 to 20 seconds.

## 1. Start the server (on the GPU PC)

```powershell
powershell -ExecutionPolicy Bypass -File server\run_live.ps1
```

It loads the models, builds one test pack (about 30 s), then listens on http://localhost:8000.
Check it: open http://localhost:8000/health and look for `"ok": true` and `"busy": false`.

A photo is named by OWLv2 (about 1 s) and then drawn from that name like a typed prompt, so it takes about as
long as a prompt. Happy accidents uses img2img on the text pipeline's own weights, so it loads nothing extra.
The MistoLine ControlNet is only used for photo packs built offline with `build_pack.py --photo`: on an 8 GB card
the UNet and the ControlNet don't fit together, so every ControlNet step swaps them and takes about 8 s.

Every request is also logged, with the date and time, to `server\out\live.log` (never committed): the prompt (or
what a photo was recognized as), the result and how long it took, and who asked. The window only keeps its last
few screens.

**Keep both windows open.** Run run_live.ps1 and cloudflared in your own PowerShell windows, not as background
jobs of an assistant session (those stop after 2 hours). Closing either window takes "Make your own" offline.

Keep the PC awake and plugged in while people use it (Windows sleep settings), and close games or other
apps that use the GPU.

## 2a. Make it reachable: Cloudflare quick tunnel (free, no account)

1. Install `cloudflared` from Cloudflare's website.
2. In a second terminal: `cloudflared tunnel --url http://localhost:8000`
3. It prints an address like `https://something-random.trycloudflare.com`. Put it in
   `web/public/live.json` as `{"url": "https://something-random.trycloudflare.com"}`, on a branch
   (e.g. `server/live-url`), then ship and merge it. The site picks it up after the deploy.
4. The address changes every time the tunnel restarts, so repeat step 3 whenever you restart it.

## 2b. Sponsor GPU credits (fill in if available)

- Provider and machine type: _to fill in_
- How the server is started there: _to fill in_
- Its public URL (goes in `web/public/live.json`): _to fill in_

## What the server allows

- `GET /health` returns `{"ok": true, "gpu": "<name>", "busy": <bool>}`.
- `POST /generate` with `{"prompt": "a teapot", "difficulty": "medium"}` or `{"imageBase64": "...", ...}`.
- One job at a time: a second request while one runs gets HTTP 503 ("busy").
- It answers within 35 seconds or returns 504, because the site stops waiting at 38 seconds.
- Every allowed prompt gets a lesson. SDXL-Lightning draws 3 drafts one by one (in one batch, 4 overflowed the
  8 GB card and timed out), and the one that will make the cleanest lesson wins: it counts how much of each drawing trimming to the difficulty's
  stroke limit would remove, and avoids a draft with a ring drawn around the subject. Trimming keeps the outline,
  small parts like windows whole, and features like eyes. The reference then shows only the lines the lesson
  teaches: faint sketch lines and scraps too small to trace are painted out. A photo is named by OWLv2 and drawn from that name; one it can't name
  gets HTTP 422 with a hint to type what it is.
- Prompts: 80 characters or less (letters, numbers, spaces, simple punctuation), checked against a blocklist that
  also catches disguised words ("n4k3d", "p.o.r.n"), and always wrapped in the line-art prompt. Photos: the browser
  sends a JPEG of at most 1536 px (so iPhone HEIC and WebP work); the server takes JPEG, PNG or WebP up to 15 MB
  and never stores them. The photo and the chosen drawing are checked for nudity and weapons with
  OWLv2, and refused with a friendly message if found (see server/pipeline/safety.py).
- Only the live site and the local dev server may call it (CORS).

## Better drawings (optional switches)

The 4-step model draws round and mirror-image subjects (a basketball's seams, a monkey's face) wobbly. Three
switches can improve that. The first three are **on in `run_live.ps1`** since Oct 13: on "a monkey" and "a basketball",
that setup drew the cleanest monkeys (4 of 4 good) and the only usable basketballs, in about 15 s per lesson instead
of 21. To turn one off, put a `#` in front of its line in `run_live.ps1` and restart.

| Switch | What it does | Cost |
|---|---|---|
| `GHOSTLINES_LIGHTNING_STEPS = "8"` | Uses the 8-step SDXL-Lightning UNet: cleaner, more even lines | About twice as long per draft, so live lessons make 2 drafts instead of 3. Download it first: set the same value in `.env` (or the shell) and run `python server/scripts/download_models.py` (about 5 GB) |
| `GHOSTLINES_PROMPT = "icon_even"` | Asks for smooth, symmetrical curves | None |
| `GHOSTLINES_PREFER_SYMMETRY = "1"` | Of two near-equally clean drafts, keeps the more mirror-symmetric one | None (side views like a walking cat stay allowed: it only breaks close calls) |
| `GHOSTLINES_LIVE_CANDIDATES = "3"` | Drafts per live lesson | Each draft adds about 5 s (4-step) or 9 s (8-step); the app waits 38 s |

Try them on "a monkey" and "a basketball" (and a cat, to check nothing got worse), and keep a lesson under about 30 s.

## Image models (optional)

Typed subjects (and photos, which are named and then drawn from text) are drawn by SDXL-Lightning by default.
Two switches try something else. Set them in `run_live.ps1` (or the shell), download with
`python server/scripts/download_models.py` under the same settings, then restart the server.

- `GHOSTLINES_IMAGE_MODEL=flux`: FLUX.1-schnell, a newer and much bigger model that follows the prompt far better (one
  whole subject, clean flat outlines). On the 8 GB card its transformer is a 4-bit GGUF file and its T5 text encoder
  is loaded in 4 bits, so it needs `pip install gguf bitsandbytes` (in requirements.txt) and about 17 GB of downloads.
  It draws straight at 768 px in 4 steps. Its own prompt is `flux_line` in `pipeline/prompts.py`.
- `GHOSTLINES_LORA=<repo id>:<file>` (with `GHOSTLINES_LORA_WORDS=<trigger words>`): a style LoRA merged into
  SDXL-Lightning's UNet at load time, e.g. a coloring-book LoRA. No extra time per drawing.

To compare them on the same 20 subjects, through exactly the live pipeline (stop the live server first):

    $env:GHOSTLINES_IMAGE_MODEL = "flux"; python server/scripts/bakeoff.py --out server/out/bake/flux-1 --drafts 1

## Drawing with OpenAI (optional switch)

SDXL-Lightning has to draw in 4 or 8 steps to fit the live time limit on an 8 GB card, and it still draws some
subjects badly (lopsided monkeys, stray furniture and lines around the subject). The server can instead ask
OpenAI's image model for the drafts. Everything after the drafts stays the same: choosing the cleanest, tracing,
OWLv2 parts, the picture safety check and the lesson order. Code: `server/pipeline/openai_images.py`, prompt:
`openai_prompt` in `server/pipeline/prompts.py`.

1. Make an API key at https://platform.openai.com/api-keys (the account needs billing set up; image models may
   also need the organization to be verified).
2. Add these lines to `.env` in the repo root (never commit it):
   ```
   OPENAI_API_KEY=sk-...
   GHOSTLINES_IMAGE_MODEL=openai
   ```
   (or remove the `#` in front of `GHOSTLINES_IMAGE_MODEL` in `run_live.ps1`).
3. Restart `run_live.ps1`. The warm-up now also asks OpenAI for 2 pictures.

| Setting | Default | What it does |
|---|---|---|
| `GHOSTLINES_IMAGE_MODEL` | `sdxl` | `openai` draws the drafts with OpenAI |
| `GHOSTLINES_OPENAI_MODEL` | `gpt-image-1` | Any OpenAI image model, e.g. `dall-e-3` |
| `GHOSTLINES_OPENAI_QUALITY` | `medium` | `low` is faster and cheaper, `high` slower and dearer (gpt-image models only) |
| `GHOSTLINES_LIVE_CANDIDATES` | 2 with OpenAI | Drafts per lesson. They are requested at the same time, so more aren't slower, but each one is paid for |

Notes:
- Each lesson costs a few cents (2 pictures). See OpenAI's pricing page for the current price per picture.
- A picture takes about 20-40 s, so with OpenAI the server waits up to 75 s and the app up to 80 s.
- If OpenAI's own safety system refuses a prompt, the user sees the same "Let's draw something else." message.
- Typed subjects and photos (OWLv2 names the photo, then the name is drawn) use OpenAI. Happy accidents
  (`?happy=1`) still uses SDXL img2img, so SDXL loads only if someone uses it.
- The GPU is still needed for OWLv2 (parts, naming photos, the safety check).

## Gemini: naming photos and checking drafts (free, optional)

With a Google Gemini API key, the live server uses Gemini as its eyes (`server/pipeline/gemini.py`):

- **Naming photos.** Gemini says what an uploaded photo shows ("a monkey", "a person"), then the lesson is drawn
  from that name. Without it, OWLv2 picks from a fixed list of about 90 subjects (so a monkey came back as "a bear",
  and a person as "a t-shirt"). If Gemini doesn't answer in 20 s, OWLv2 names the photo as before.
- **Checking drafts.** Gemini looks at every draft and says whether it shows the subject and whether it has extra
  marks (arcs, rings, ground lines, scenery). Bad drafts count as less clean when one is chosen, and when no draft is
  good and there is time, the AI is asked to draw again once (`make_pack`, `RETRY_HINT` in `api.py`).

Separately, and always on (no key needed): long stray arcs and ground lines joined to the subject (the big arc over a
car) are found and erased from every draft before it is traced (`server/pipeline/stray_lines.py`).

To turn Gemini on, add the key to `.env` in the repo root (never commit it; the repo is public) and restart
`run_live.ps1`:
```
GEMINI_API_KEY=...
```

| Setting | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | (none) | Turns Gemini on |
| `GHOSTLINES_GEMINI` | on with a key | `0` turns it off without removing the key |
| `GHOSTLINES_GEMINI_MODELS` | `gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3-flash-preview` | Models tried in turn |

Notes:
- The free tier is enough: reading pictures is free (Gemini's image models are not, so it doesn't draw). The free
  models are often busy (HTTP 503) or over their daily quota (429); the server then tries the next one, and after
  20 s carries on without Gemini. The log (`server/out/live.log`) says what happened.
- A lesson takes 5-10 s longer with the check, and about twice as long when the AI is asked to draw again, so the
  server now waits up to 75 s (the app 80 s).
- Tested on Oct 13 against the real API: it named an astronaut, a coffee cup, a cat, a rocket and a monkey
  correctly, flagged the car's arc and the fox's and cat's background rings, and passed the clean drafts.

