# Ghost Lines: Aarush's Playbook

Everything Aarush runs, in order: setup, the base site, the GPU pipeline, the engine, the live server and the
merges. Every prompt has Before steps, the prompt to paste, and After steps. This file exists so both halves of the
team (and their Claude sessions) know the order Aarush works in. Jeff's side is in `docs/JEFF_PLAYBOOK.md`.

- Repo: aarushgupta850/Bananahacks-. Live site: https://aarushgupta850.github.io/Bananahacks-/
- Copied from Aarush's Claude Doc (Oct 10, 2026). Checkboxes show his progress at the time it was copied
  (Sun Oct 11, about 1:15 PM EDT). The original ended at a "Troubleshooting" heading with no content.

## How to use this playbook

Every prompt follows the same five rules.

| Rule | What it means here |
|---|---|
| One milestone per prompt | Each prompt builds one reviewable piece. If something breaks, you debug only that piece. |
| Plan Mode for multi-step work | Prompts marked Plan start in Plan Mode, so you see Claude's plan before any file changes. Direct prompts are small enough to run straight away. |
| Clean sessions | Start every prompt with /clear, so old conversation doesn't crowd out the new task. |
| CLAUDE.md holds the shared rules | Stack, ownership, commands and "never" rules live in CLAUDE.md files (Step 0), so prompts stay short. |
| Skills for repeated workflows | /ship, /sync and /build-pack replace steps you'd otherwise type every time. |

### Plan Mode, step by step

1. Press Shift+Tab until the status bar under the prompt box says "plan mode on". Or start your message with /plan.
2. Paste the prompt. Claude reads files and writes a plan, without changing anything.
3. Read the plan. If something is wrong, choose No, keep planning and say what to change.
4. When it's right, approve it. Claude then makes the changes.

### The three skills (you type these; Claude can't run them on its own)

- `/sync` merges the latest main into your branch and reruns the tests. Run it before every prompt.
- `/ship <summary>` runs the tests and build, commits, pushes and opens a pull request. Run it after you've checked a prompt's After list.
- `/build-pack <subject> <difficulty>` builds one subject pack on the GPU (from A3 on).

### Golden rules

- Never push directly to main. Everything goes through a pull request.
- You merge your own pull request on GitHub once its After checks pass and the PR's test check is green.
- Never change web/src/engine/types.ts without Jeff agreeing first.
- If Claude fails the same fix twice, type /clear and paste the prompt again along with the error message.
- If a session feels slow or confused, run /context. If it's crowded, ship what works and /clear.

## Timeline

Aarush owns the resource-heavy work: the GPU, the image AI pipeline, the subject packs, the engine math, the live
server, and the checkpoints.

1. Saturday, now to about 12:45 AM: Step 0, then B1 to B4 (the base site). Hand off to Jeff.
2. Until about 1:30 AM: A1a (start the model downloads first), then A1b. Then sleep.
3. Sunday 8 AM to 11 AM: A2a, A2b, A2c (the pipeline).
4. 11 AM to 1 PM: A3 (build and check the packs).
5. About 1 PM: M1, checkpoint 1, on a call with Jeff.
6. 1 PM to 4:30 PM: A4a, A4b, A4c, A4d (the engine).
7. About 4:30 PM: M2, checkpoint 2 and tuning, on a call with Jeff.
8. 5 PM to 7 PM: A5 (the live server).
9. 7 PM: M3, the feature freeze. After this, bug fixes only.
10. 7 PM to 10:30 PM: fixes, A6 only if everything is solid, help Jeff with the video, submit.

### What Jeff is waiting on from Aarush

- B2 on main (the contract and mock engine) before he starts J1a.
- B3 on main (the app shell and basic canvas) before J1a, too. Message him when B3 is merged.
- The packs on main (A3) before he starts J4 Sunday afternoon.
- The real engine on main (A4d) before M2.

## Step 0a: tools, repo and root CLAUDE.md

Manual, about 15 minutes. No prompt yet.

Before
- [ ] Install Git, Node.js 20 LTS, Python 3.11 (3.10 also works) and Claude Code. Optional but helpful: the GitHub CLI (gh), so /ship can open pull requests by itself.
- [ ] Confirm the repo aarushgupta850/Bananahacks- exists on GitHub and is public (the hackathon requires it).

Steps
1. Clone it: `git clone https://github.com/aarushgupta850/Bananahacks-.git`, then `cd Bananahacks-`.
2. Create a file named CLAUDE.md in the repo root with the project rules (see the root `CLAUDE.md` in this repo).
3. Continue to Step 0b before committing.

## Step 0b: folder rules and skills

Create `web/CLAUDE.md`, `server/CLAUDE.md` and the skills `.claude/skills/ship`, `sync` and `build-pack`
(all in this repo). The folder CLAUDE.md files load only when Claude works in that folder, which keeps the root
file short.

After
- [x] This one setup commit goes straight to main, because the repo is still empty: `git add -A`, `git commit -m "Add Claude memory and skills"`, `git push`
- [x] In the repo root, run claude, then /context, and check that CLAUDE.md appears under Memory files
- [x] Type / and check that ship, sync and build-pack appear in the menu

## Base site, part 1

### B1: scaffold, CI and deploy

Mode: Plan · Branch: setup/scaffold · Time: about 15 minutes

Before
- [x] Step 0 is committed on main
- [x] In the repo root: claude, then /clear
- [x] Shift+Tab until "plan mode on"

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch setup/scaffold.

Goal: an empty Vite + React + TypeScript app in /web that runs tests on every pull request and deploys to
GitHub Pages on every push to main.

1. Scaffold Vite with the react-ts template into /web. web/CLAUDE.md already exists there: keep it
   (scaffold into a temp folder, then move the files in).
2. Vite config: base '/Bananahacks-/'. Add vitest with one trivial passing test, and the npm script "test": "vitest".
   Add the dependencies perfect-freehand and html-to-image.
3. Create these folders, each with a one-line README.md saying what goes there:
   src/screens, src/canvas, src/engine, src/engine/real, src/engine/__tests__, src/lib, src/styles, src/dev,
   public/subjects.
4. .github/workflows/deploy.yml: on push to main, Node 20, in web/: npm ci, npm test -- --run, npm run build,
   then upload web/dist with actions/upload-pages-artifact and deploy with actions/deploy-pages.
   Permissions: contents read, pages write, id-token write.
5. .github/workflows/test.yml: on pull_request, Node 20, in web/: npm ci, npm test -- --run, npm run build.
6. Root .gitignore: node_modules, dist, .env, __pycache__, .venv, *.safetensors, *.ckpt, *.bin,
   server/models, server/cache, server/out. Root .env.example with HF_HOME= and ALLOWED_ORIGIN=.

Done when: npm test -- --run and npm run build pass in web/. Stop and summarize what you created. Do not commit.
```

After
- [x] In a second terminal: cd web, npm run dev, open http://localhost:5173/Bananahacks-/ and see the default Vite page
- [x] web/CLAUDE.md still exists
- [x] /ship Scaffold Vite app, CI and Pages deploy
- [x] On GitHub: Settings → Pages → Source: GitHub Actions
- [x] Merge the PR once its test check is green. Watch the Actions tab until the deploy finishes, then open the live site and see the Vite page.

### B2: shared contract and mock engine

Mode: Plan · Branch: setup/contract · Time: about 20 minutes. The most important file in the project: both halves
build against it.

Before
- [x] B1 is merged and the live site works
- [x] /clear, then /sync
- [x] Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch setup/contract.

Goal: the shared contract and a mock engine, so Jeff can build every screen before the real engine exists.

1. Create web/src/engine/types.ts with EXACTLY the contract code (see web/src/engine/types.ts in this repo).
   You may add comments; do not change any shape.
2. web/src/engine/mock.ts: a deterministic mock Engine with plausible fake data
   (test: head 24% too big; retest: 5%; total score 48 -> 79).
   Mock Teacher: advances one step per stroke, seeded accuracies between 0.5 and 0.95;
   in auto mode the help level fades guided -> hints after 5 strokes and -> checkin after 10;
   ghosts are the pack's strokes for the current step; done after the last step.
3. web/src/engine/real/index.ts exports realEngine, which delegates to the mock for now.
   web/src/engine/index.ts exports engine: the mock if the URL has ?engine=mock or VITE_ENGINE=mock,
   otherwise realEngine. console.info which one is active.
4. web/src/lib/packs.ts: loadIndex(), loadPack(id), resolveAsset(pack, path), fetching from
   import.meta.env.BASE_URL + 'subjects/'. Paths starting with data: or http are used as-is.
   Check the pack's shape at runtime and throw clear error messages.
5. web/src/lib/live.ts: getLiveUrl() reads public/live.json ({"url": ""}); checkLive() GETs <url>/health with a
   2 s timeout and returns true/false without ever throwing; generate({prompt?, imageBase64?, difficulty}) POSTs
   <url>/generate with a 25 s timeout and returns a Pack. Create public/live.json with {"url": ""}.
6. CONTRACT_CHANGES.md at the repo root with a title and a "v1 created" entry.
7. Tests: every mock Engine method returns objects with the right shape.

Done when: tests and build pass. Stop and summarize. Do not commit.
```

After
- [x] Open web/src/engine/types.ts and compare it with the contract: only comments may differ
- [x] npm test -- --run passes
- [x] /ship Add shared contract and mock engine, then merge the PR once the check is green
- [x] Message Jeff: "The contract is on main."

## Base site, part 2

### B3: app shell, demo pack, inspector, basic canvas

Mode: Plan · Branch: setup/shell · Time: about 25 minutes

Before
- [x] B2 is merged
- [x] /clear, then /sync
- [x] Dev server running in a second terminal (cd web, npm run dev)
- [x] Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch setup/shell.

Goal: a clickable app shell that runs on the mock engine and one hand-made demo pack.

1. Demo pack in web/public/subjects/demo-fox-medium/:
   - pack.json following types.ts: a simple fox in 768 space. A construction circle (head) and ellipse (body),
     outline strokes, two triangle ears, eyes, nose, a tail curve. About 12 strokes, 6 steps,
     parts head/body/ears/eyes/tail, keyPoints on every stroke. pipeline: the six stages with text only.
   - target.svg and thumb.svg drawn from the same points (black 4 px round lines on white).
   - web/public/subjects/index.json with one subject:
     { subject: "fox", title: "Fox (demo)", thumb: "demo-fox-medium/thumb.svg", packs: { medium: "demo-fox-medium" } }
   - A vitest test that the demo pack matches the contract.
2. src/styles/tokens.css and global.css from the tokens in web/CLAUDE.md. Load Fraunces and Inter
   from Google Fonts in index.html.
3. App.tsx: a screen state machine plus a SessionContext holding pack, testStrokes, testAnalysis, weaknesses,
   steps, teachRecording, modeHistory, retestStrokes, retestAnalysis.
   Placeholder screens in src/screens: SubjectPicker, Reference, Test, WeakSpots, Teach, Retest, Report,
   plus a PipelinePanel modal. Each shows its title, one sentence about what it will do, and Next/Back buttons,
   so the whole flow clicks through with the demo pack and the mock engine.
4. Basic canvas (Jeff will polish these):
   - src/canvas/DrawingCanvas.tsx: pointer events, perfect-freehand rendering, records UserStroke in
     768 space scaled from the display size. Props: strokes, onStroke, readOnly.
   - src/canvas/GhostLayer.tsx: an SVG overlay that draws Ghost[] in the accent color at 30% opacity,
     with pointer-events: none.
5. src/dev/PackInspector.tsx, opened when the URL has ?debug=pack&id=<packId>: the target image; the plan strokes
   drawn over it, numbered in order and colored by tier; part boxes with labels; the steps list; stroke and step counts.

Done when: the flow clicks through end to end; ?debug=pack&id=demo-fox-medium shows the fox plan;
tests and build pass. Stop and summarize. Do not commit.
```

After
- [x] Click from Subject Picker all the way to Report and back
- [x] Draw a stroke on the canvas
- [x] `?debug=pack&id=demo-fox-medium` shows numbered, colored strokes and part boxes
- [x] /ship Add app shell, demo pack and pack inspector, then merge once the check is green
- [x] Check the live site clicks through the same way
- [x] Message Jeff: "The base is live. Start J1a."

### B4: server stub and project docs

Mode: Plan · Branch: setup/server · Time: about 10 minutes

Before
- [x] B3 is merged
- [x] Python installed (python --version shows 3.10 or 3.11)
- [x] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Create and use branch setup/server.

Goal: the /server skeleton and the project docs.

1. server/requirements.txt: fastapi, uvicorn, numpy, opencv-python, scikit-image, scipy, pillow, transformers,
   diffusers, accelerate, safetensors, controlnet-aux, pydantic, pytest. Add a comment that torch is installed
   separately with CUDA.
2. server/api.py: FastAPI app with GET /health returning {"ok": true}, and CORS for http://localhost:5173 and
   https://aarushgupta850.github.io.
3. server/build_pack.py: argparse stub (--prompt, --photo, --subject, --difficulty, --seed) that prints TODO.
4. Empty server/pipeline/__init__.py, plus server/scripts/ and server/overrides/ (each with .gitkeep).
   One pytest that imports api.py.
5. README.md: the pitch; the live link; setup in 3 commands or fewer for web and for server; a short ownership
   summary pointing to CLAUDE.md; an empty "AI tools used" section; a link to CREDITS.md.
6. CREDITS.md: every library and font used so far, with its license.

Done when: the web tests and build pass. Stop and summarize. Do not commit.
```

After
- [x] README reads well and the live link is right
- [x] /ship Add server stub and project docs, then merge once the check is green

### Hand-off to Jeff

- [x] On GitHub: Settings → Collaborators → add Jeff
- [x] Send Jeff the repo link and "Ghost Lines: Jeff's Playbook"
- [x] If Jeff plans an overnight cloud run, authorize the Claude GitHub app for the repo when it asks; as the owner, only Aarush can grant that access

## Tonight on the GPU

### A1a: Python environment and model downloads

Mode: Plan · Branch: server/setup · Time: about 20 minutes, then the downloads run on their own

Before
- [x] B4 is merged
- [x] At least 30 GB free on a drive (models are large)
- [x] Close games or other apps that use the GPU
- [x] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Create and use branch server/setup.

Goal: a working GPU Python environment, with model downloads running in the background.

1. Check and report: nvidia-smi (GPU name, VRAM, driver CUDA version), python --version (need 3.10 or 3.11;
   tell me if it's missing), and free disk space.
2. Create server/.venv. Install the CUDA build of PyTorch that matches the driver, using the command from
   pytorch.org's install selector. Then pip install -r server/requirements.txt.
   Verify torch.cuda.is_available() and print the GPU name and VRAM.
3. Put HF_HOME in .env, pointing to a folder with at least 30 GB free.
4. Write server/scripts/download_models.py. Verify each repo id on Hugging Face first, then download:
   - stabilityai/stable-diffusion-xl-base-1.0 (fp16 variant only)
   - ByteDance/SDXL-Lightning (the 4-step UNet checkpoint only)
   - one SDXL ControlNet that accepts line art: TheMistoAI/MistoLine, or xinsir/controlnet-union-sdxl-1.0
   - lllyasviel/Annotators (only the files the controlnet_aux line-art detector needs)
   - google/owlv2-base-patch16-ensemble
   Print progress and sizes.
5. Give me the exact command to run the download script in a separate terminal.

Done when: CUDA works and I have the download command. Stop and summarize GPU, VRAM and disk. Do not commit.
```

After
- [ ] torch.cuda.is_available() printed True
- [ ] Start the download command in a new terminal and leave it running
- [ ] Write down your VRAM (8 or 16 GB). At 8 GB the pipeline uses CPU offload, which is slower but works.
- [ ] /ship GPU environment and model download script. Don't merge yet; A1b continues on this branch.

### A1b: speed test and line-art prompt

Mode: Plan · Branch: server/setup (same) · Time: about 30 minutes

Before
- [ ] The downloads have finished (check that terminal)
- [ ] Save a clear photo of a simple object (a mug or a shoe) as server/scripts/test_photo.jpg
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Stay on branch server/setup.

Goal: measure the speed and quality of the image AI on this PC, and choose the line-art prompt.

Write server/scripts/speedtest.py, saving outputs to server/out/speedtest/:
a. Text to line art: SDXL-Lightning, 4 steps, guidance 0, at 1024 px, downscaled to 768.
   Prompt: "simple clean black line drawing of {subject}, single subject, centered, white background,
   thick even outlines, no shading, no color, coloring book style".
   Negative: "shading, gradient, texture, color, background, text, watermark, multiple subjects".
   Generate 4 candidates for "a fox" and time each one.
b. Photo to line art: extract line art from server/scripts/test_photo.jpg with the controlnet_aux LineartDetector,
   then regenerate a clean drawing with SDXL-Lightning plus the line-art ControlNet. Time it.
c. Run OWLv2 on the best fox with labels head, body, ear, eye, tail, leg. Save an image with the boxes drawn. Time it.
d. Try 3 prompt variants and keep the one with the cleanest lines (fewest specks, closed outlines, no shading).
   Save it in server/pipeline/prompts.py.
Record peak VRAM with torch.cuda.max_memory_allocated(). If VRAM is 8 GB or less, use enable_model_cpu_offload().
Write server/SPEEDTEST.md: a timing table, peak VRAM, the chosen models and prompt, and each model's license.
Add the models to CREDITS.md.

Done when: SPEEDTEST.md has real numbers and the sample images are saved. Stop and summarize. Do not commit.
```

After
- [ ] Open the images in server/out/speedtest/. Are the fox's lines clean, dark and closed?
- [ ] If they're messy, ask in the same session: "Search Hugging Face for an SDXL line-art or coloring-book LoRA, test it, and record its license in CREDITS.md."
- [ ] /ship Speed test and line-art prompt, then merge server/setup once the check is green

### Bedtime checklist

- [ ] Base site live, and Jeff has the repo and his playbook
- [ ] All your PRs merged (nothing half-finished on a branch)
- [ ] Alarm set for Sunday morning
- [ ] Sleep. Tomorrow's pipeline work goes faster with a clear head.

## Pipeline (Sunday morning)

All three prompts share the branch server/pipeline. Merge it after A2c.

### A2a: generate and trace

Mode: Plan · Time: about 60 minutes

Before
- [ ] `git checkout main`, `git pull`
- [ ] Check GitHub for Jeff's PRs from last night; nothing of yours depends on them
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Create and use branch server/pipeline.

Goal: images in, clean strokes out.

1. server/pipeline/generate.py:
   - from_prompt(subject, difficulty, n=4, seed) returns a list of 768 x 768 PIL images, using the prompt
     in pipeline/prompts.py. Difficulty changes the prompt: simple adds "very simple, few lines,
     minimal detail"; detailed adds "more detail, a few interior lines".
   - from_photo(path, difficulty): extract line art, then regenerate a clean drawing with the line-art ControlNet.
     Never trace the raw photo.
   - Load each model once (module-level cache).
2. server/pipeline/trace.py: trace(image) returns a list of polylines in 768 space.
   Grayscale -> Otsu binarize -> remove specks under 30 px -> skeletonize (skimage) -> pixel graph
   (8-connectivity) -> split at junctions and endpoints -> walk each branch into an ordered polyline
   (handle closed loops) -> drop pieces under 15 px -> merge pieces that meet at a junction with a direction
   change under 30 degrees -> Ramer-Douglas-Peucker simplify with epsilon 1.5 px.
3. pytest with a synthetic image (OpenCV circle plus two lines): assert the expected stroke count and
   approximate lengths. Tests must not need the GPU.
4. server/scripts/try_trace.py: generate 4 foxes, trace each, print stroke counts, and save overlays
   (strokes in random colors over the image) to server/out/trace/.

Done when: tests pass and the overlays show sensible, unbroken strokes. Stop and summarize. Do not commit.
```

After
- [ ] Open the overlays in server/out/trace/: they should look like strokes an artist would draw, not hundreds of fragments
- [ ] If the strokes are broken into tiny pieces, tell Claude in the same session what you see and let it adjust the thresholds
- [ ] /ship Generate line art and trace strokes

### A2b: parts and the lesson plan

Mode: Plan · Time: about 45 minutes

Before
- [ ] A2a shipped
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Stay on branch server/pipeline.

Goal: turn traced strokes into a lesson plan an artist would follow.

1. server/pipeline/parts.py: OWLv2 with per-subject label lists:
   fox and cat: head, body, ear, eye, tail, leg; face: head, eye, nose, mouth, ear, hair;
   mug: body, handle, rim; sneaker: sole, toe, laces, heel; house: roof, wall, door, window, chimney;
   bird: head, body, wing, tail, beak, leg; fish: body, tail, fin, eye, mouth; anything else: head, body.
   Use a score threshold and NMS, and keep at most 2 per label (ids like ear_left, ear_right).
   If server/overrides/<packId>.parts.json exists, use it instead. If nothing is found, return [].
2. server/pipeline/order.py:
   - Construction strokes: 48-point ellipses fitted to the head and body boxes, tier "construction".
   - Outline: strokes mostly within 6 px of the outer silhouette (fill the drawing, take the external contour).
   - Structure vs detail: inner strokes longer than 8% of the drawing diagonal are "structure", shorter are "detail".
   - partId: the part box containing most of the stroke's points, else null.
   - Order: by tier (construction, outline, structure, detail), then center-outward within each tier.
   - Steps: group 1-4 consecutive strokes of the same tier and part. Template labels: "Block in the {part}",
     "Outline the {part}", "Add the {part}". Tips use real sizes: "Keep the {part} about {n}% of the drawing height".
   - keyPoints per stroke: endpoints, corners (turn over 45 degrees), curvature peaks.
3. pytest for ordering, part assignment and step grouping on synthetic data (no GPU).

Done when: tests pass. Print the plan (steps with labels and stroke counts) for one generated fox.
Stop and summarize. Do not commit.
```

After
- [ ] Read the printed plan: big shapes first, details last, labels that make sense
- [ ] /ship Parts detection and lesson plan

### A2c: one command builds a validated pack

Mode: Plan · Time: about 45 minutes

Before
- [ ] A2b shipped
- [ ] Dev server running (cd web, npm run dev) so you can use the pack inspector
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Stay on branch server/pipeline.

Goal: one command builds a complete subject pack that matches the contract.

1. server/pipeline/schema.py: pydantic models that mirror web/src/engine/types.ts exactly
   (Pack, Part, PlanStroke, Step, PipelineStage, SubjectIndex). Add a test that it accepts
   web/public/subjects/demo-fox-medium/pack.json.
2. server/build_pack.py (replace the stub): --prompt or --photo, --subject, --difficulty, --seed.
   Generate 4 candidates -> trace each -> keep the one with the fewest strokes inside the 6-60 gate
   (retry once with a new seed, then fail with a clear message) -> parts -> lesson plan.
   Write one flat pack folder per difficulty: web/public/subjects/<subject>-<difficulty>/ (e.g. fox-medium):
   - target.png (768, clean black lines on white), thumb.png (256), pack.json
   - pipeline/candidate-0.webp to candidate-3.webp, pipeline/skeleton.webp, pipeline/parts.webp
     (webp, 300 KB or less each); photo packs also get pipeline/source.webp
   Fill pack.pipeline with PipelineStage entries in this order, each with a short plain-English label:
     source     -> text: the prompt (photo packs: image "pipeline/source.webp")
     candidates -> images: the 4 candidate paths
     chosen     -> image: the SAME path as the chosen candidate (the panel highlights the matching one)
     skeleton   -> image "pipeline/skeleton.webp"
     parts      -> image "pipeline/parts.webp"
     order      -> text only (the app animates the lesson from strokes and steps)
3. Update web/public/subjects/index.json (the SubjectIndex type) by merging, never overwriting other subjects:
   { subject: "fox", title: "Fox", thumb: "fox-medium/thumb.png", packs: { medium: "fox-medium" } }.
   A subject with only one level lists one key in packs.
4. Validate pack.json with schema.py before writing anything; fail loudly on a mismatch.

Done when: python server/build_pack.py --prompt "a fox" --subject fox --difficulty medium produces a pack
that validates, and the web app's pack inspector (?debug=pack&id=fox-medium) shows a sensible plan.
Stop and summarize. Do not commit.
```

After
- [ ] `?debug=pack&id=fox-medium` shows numbered strokes, part boxes and steps
- [ ] Each file in web/public/subjects/fox-medium/pipeline/ is under 300 KB
- [ ] /ship One-command subject pack builder, then merge server/pipeline once the check is green

## Packs and checkpoint 1

### A3: build and check the packs

Mode: Direct, with the /build-pack skill · Branch: packs/initial · Time: about 2 hours, mostly GPU waiting

Before
- [ ] server/pipeline is merged
- [ ] /clear, then /sync
- [ ] Tell Claude: Create and switch to branch packs/initial.
- [ ] Dev server running, so you can open the inspector

Steps. Run one at a time; after each, open the inspector link it prints.
- [ ] /build-pack fox medium
- [ ] /build-pack cat medium
- [ ] /build-pack face medium
- [ ] /build-pack mug medium
- [ ] /build-pack sneaker medium
- [ ] /build-pack house medium
- [ ] /build-pack bird medium
- [ ] /build-pack fish medium
- [ ] Then simple and detailed for fox, cat, face and mug (for example /build-pack fox simple)

Check each pack in the inspector: big shapes come first and details last; part boxes sit on the right parts;
6 to 60 strokes; step labels make sense. Mark its row in server/PACK_QA.md as OK or describe the problem.

If a pack's parts are wrong, run this Direct prompt:

```
Follow CLAUDE.md and server/CLAUDE.md. Stay on branch packs/initial.
The pack <packId> has wrong parts: <describe what's wrong>.
Read its pack.json and target.png, write server/overrides/<packId>.parts.json with corrected boxes,
rebuild the pack with the same seed, and update its row in server/PACK_QA.md. Stop and summarize.
```

If a pack's lines are messy: ask Claude to rebuild it with a different --seed, then check it again.

After
- [ ] Ask Claude: Remove demo-fox-medium from web/public/subjects/index.json and report the total size of web/public/subjects. Keep it under 30 MB.
- [ ] /ship Initial subject packs, then merge once the check is green
- [ ] Message Jeff: "Packs are on main."

### M1: checkpoint 1, packs meet the screens

Mode: Plan · Branch: integration/packs · Time: about 30 minutes, on a call with Jeff

Before
- [ ] Your packs PR is merged, and Jeff has merged his web/screens PR
- [ ] Call Jeff
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md. Create and use branch integration/packs from main.

Goal: confirm Jeff's screens load the real packs, and fix anything on the pack side.
1. Run the app with ?engine=mock. Check that the subject picker lists every subject from index.json with
   thumbnails and the right difficulties, and that the Reference screen shows every pack's target.
2. If a pack.json is wrong, fix the pipeline or schema and rebuild that pack.
   If a screen is wrong, don't edit it: write the issue down for Jeff, one line each.
   Never change types.ts.
3. Tests and build pass.

Done when: every pack loads in the UI. Print the list of screen issues for Jeff. Stop. Do not commit.
```

After
- [ ] Click through each subject yourself, with Jeff watching on the call
- [ ] Send Jeff the issue list; he fixes screen issues on his side
- [ ] If you changed anything: /ship Fix pack issues from integration and merge. If not, delete the branch.

## Engine, part 1

A4a and A4b share the branch engine/teacher. Merge it after A4b.

### A4a: geometry and stroke matching

Mode: Plan · Time: about 45 minutes

Before
- [ ] M1 done
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch engine/teacher from main.
Only edit web/src/engine/real and web/src/engine/__tests__.

Goal: the geometry and stroke-matching core of the real engine.

1. real/config.ts: all tunable constants in one exported object, starting with accuracyScale 0.12 and
   doneThreshold 0.5.
2. real/geometry.ts: resample(points, n = 64) by arc length; length; centroid; bbox; diagonal;
   discreteFrechet(a, b); symmetricChamfer(a, b) that tries both directions of b and keeps the better;
   procrustes(pairs, maxRotationDeg) returning {scale, rotation, tx, ty} with the rotation clamped;
   applyTransform; lerpTransform(a, b, t).
3. real/match.ts: matchStroke(userStroke, ghosts, drawingDiagonal) returns {ghostId, accuracy} or null.
   Pick the closest unmatched ghost by Chamfer distance, confirm with Frechet distance.
   accuracy = clamp(1 - frechet / (accuracyScale * drawingDiagonal), 0, 1).
4. Tests: identical strokes give accuracy above 0.95; a reversed stroke still matches; a shifted copy scores lower
   but above 0.5; an unrelated scribble returns null or below 0.3; procrustes recovers a known transform;
   matching against 10 ghosts takes under 5 ms.

Comment each function in plain language. Done when: tests pass. Stop and summarize. Do not commit.
```

After
- [ ] Tests pass
- [ ] Ask Claude (Direct): "Explain in two sentences each what Chamfer distance, Fréchet distance and Procrustes do in our code." You'll need this for judges and the sponsor demo call.
- [ ] /ship Geometry and stroke matching

### A4b: the Teacher

Mode: Plan · Time: about 60 minutes

Before
- [ ] A4a shipped
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch engine/teacher.
Only edit web/src/engine/real and web/src/engine/__tests__.

Goal: implement the Teacher interface from types.ts in real/teacher.ts as createTeacher(pack, steps, mode).

Behavior:
- Track the current step. A ghost is done at accuracy >= doneThreshold; a step is complete when all its ghosts
  are done; done = all steps complete. A stroke that matches nothing returns accuracy null, with no penalty.
- Adaptation: keep matched point pairs (plan <-> user). After each matched stroke, fit procrustes with rotation
  limited to 10 degrees, move 60% of the way toward the new transform, and apply it to all remaining ghosts and
  key points, so the guides follow where the user is actually drawing.
- Ghosts by help level: guided = full strokes of the current step (plus the next step's if the current step has
  only one stroke); hints = key points plus construction strokes only; checkin = none.
- Auto mode: rolling accuracy over the last 5 matched strokes; above 0.80 step down one level, below 0.60 step
  back up; at least 3 strokes between changes; log every ModeChange. Put 0.80, 0.60, 5 and 3 in config.ts.
- Check-in warnings: if a matched stroke implies its part is more than 25% too big or small, return a warning
  like "The head is getting large".
- showMe() returns the current step's full ghosts, adapted. setMode() returns the new state.
Wire createTeacher into realEngine in real/index.ts; the other methods still delegate to the mock.

Tests, using a real pack from web/public/subjects plus synthetic strokes:
- exact copies of the plan complete every step
- copies scaled 1.2x and shifted still score above 0.8 after adaptation
- scribbles never crash
- auto mode fades for a good drawer and steps back up for a bad one
- addStroke takes under 50 ms on the largest pack

Done when: tests and build pass. Stop and summarize. Do not commit.
```

After
- [ ] If Jeff's Teach screen is merged: open the app without ?engine=mock, pick Fox, reach Teach, and draw off-center. The guides should slide over to where you're drawing.
- [ ] /ship Adaptive Teacher with assistance modes, then merge engine/teacher once the check is green
- [ ] Tell Jeff the real Teacher is on main

## Engine, part 2 and checkpoint 2

A4c and A4d share the branch engine/measure. Merge it after A4d.

### A4c: alignment and measurement

Mode: Plan · Time: about 60 minutes

Before
- [ ] engine/teacher is merged
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch engine/measure from main.
Only edit web/src/engine/real and web/src/engine/__tests__.

Goal: measure a solo drawing fairly against the target.

1. real/align.ts: ICP over the resampled points of all user strokes vs all target strokes (up to 30 iterations),
   with a procrustes fit each round: free shift and scale, rotation limited to 5 degrees (so a tilted head still
   counts as a mistake). Return the transform, overallScale and overallOffset.
2. real/analyze.ts: analyze(pack, strokes) returning Analysis from types.ts:
   - alignedStrokes: the user strokes moved into the aligned frame
   - assign each stroke to the nearest part (mean distance to that part's plan strokes); ignore strokes more than
     15% of the diagonal away from every part
   - per part: sizeError (part box diagonal / whole-drawing box diagonal, user vs target), offset (center offset as
     a fraction of drawing height), aspectError, tiltDeg (principal axis), good (all within 10%), userBox;
     a part with no strokes is missing
   - shapeSimilarity = clamp(1 - chamfer(all user points, all target points) / (0.08 * diagonal), 0, 1)
   - lineConfidence = mean of a smoothness score (from the mean turning angle) and 1 - overstroke rate
     (strokes lying mostly within 4 px of an earlier stroke)
   - pack without parts: usedFallback true, parts []
   Put 0.08, 15%, 10% and 4 px in config.ts.
3. Tests: an exact copy gives all parts good and shapeSimilarity above 0.95; a copy scaled to 0.7 is still good
   (overallScale near 0.7, not penalized); a head scaled 1.3x gives head sizeError near +0.3; a removed tail is
   reported missing; a scribble does not crash.

Done when: tests pass. Stop and summarize. Do not commit.
```

After
- [ ] Tests pass
- [ ] /ship Whole-drawing alignment and measurement

### A4d: weaknesses, score and coaching

Mode: Plan · Time: about 45 minutes

Before
- [ ] A4c shipped
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch engine/measure.
Only edit web/src/engine/real and web/src/engine/__tests__.

Goal: finish the real engine so it no longer uses the mock anywhere.

1. findWeaknesses: rank missing parts first, then the largest |sizeError|, then offsets, then shape, then line.
   Return up to 3, with messages like "Head 24% too big", "Ears 15% too low", "Forgot the tail".
2. buildLesson: move steps for the weak parts earlier, but keep construction steps first.
3. score: proportion = mean over parts of max(0, 1 - |sizeError| - |offset.dx| - |offset.dy|), with missing parts
   counting 0; total = round(40 * proportion + 35 * shape + 25 * line). Put the weights in config.ts.
4. coach(pack, test, retest): 3 fix items from the test's biggest errors, each marked improved if the retest error
   is at least 40% smaller, otherwise not-yet, with text like "Head size: 24% too big -> 5%".
   2 good items from the retest's best parts, like "Your ear position was spot on, within 4%". Templates only.
5. realEngine in real/index.ts: replace all remaining mock delegation.
6. Tests: an exact copy scores at least 95; a copy scaled to 0.7 scores at least 90; an oversized head is the top
   weakness; coach marks improvement correctly; a pack without parts still works.

Done when: tests and build pass. Then list every constant in config.ts with its current value.
Stop and summarize. Do not commit.
```

After
- [ ] Save the list of constants somewhere; you'll tune them at M2
- [ ] /ship Real engine: weaknesses, score and coaching, then merge engine/measure once the check is green
- [ ] Tell Jeff the real engine is on main, and that it's time to draw fixtures

### M2: checkpoint 2, tuning with real drawings

Mode: Plan · Branch: integration/engine · Time: about 45 minutes, on a call with Jeff

Before
- [ ] engine/measure is merged
- [ ] You and Jeff each draw fox, face, mug and house three ways (careless, rough, careful) on the live site or local app with ?dev=1, and export each drawing. Name the files like fox-careful-aarush.json and fox-careful-jeff.json. That's 24 files total.
- [ ] /clear, then /sync, then tell Claude: Create and switch to branch integration/engine.
- [ ] Copy all 24 files into web/src/engine/__tests__/fixtures/
- [ ] Plan Mode on

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch integration/engine.

Goal: the real engine's numbers are fair on real drawings.
1. Add tests using the fixtures in web/src/engine/__tests__/fixtures/: for each subject and each person,
   careful > rough > careless in total score; no crash on any fixture.
2. Tune ONLY the constants in web/src/engine/real/config.ts until the ordering holds and every careful copy
   scores at least 80. Log each change and the reason in CONTRACT_CHANGES.md.
3. Add a dev-mode timing log for addStroke and confirm it stays under 50 ms on the largest pack.
4. Tests and build pass.

Done when: the fixture tests pass. Report the final constants and the score of every fixture.
Stop. Do not commit.
```

After
- [ ] Read the fixture scores together with Jeff: do they feel fair?
- [ ] Both of you click through the whole flow with the real engine
- [ ] /ship Real engine tuned on real drawings, then merge once the check is green

## Live server and feature freeze

### A5: live generation server

Mode: Plan · Branch: server/live · Time: about 60 minutes

Before
- [ ] M2 merged
- [ ] Ask in the Banana Hacks Discord whether sponsor GPU compute credits are available. If so, a cloud GPU is more reliable during judging than your PC.
- [ ] Install cloudflared, Cloudflare's tunnel tool, from Cloudflare's website
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md and server/CLAUDE.md. Create and use branch server/live.

Goal: an optional live generation server the hosted site can use. The app must still work when it's offline.

1. server/api.py:
   - GET /health returns {"ok": true, "gpu": "<name>", "busy": <bool>}
   - POST /generate {prompt?, imageBase64?, difficulty} builds a pack in memory with the existing pipeline and
     returns Pack JSON whose target, thumb and pipeline images are data: URLs.
   - One job at a time (asyncio lock): if busy, return 503 {"error": "busy"}. Hard timeout 25 s: return 504.
   - Safety: prompts of 40 characters or less, letters/numbers/spaces only, checked against a blocklist of unsafe
     words, and always wrapped in the line-art prompt. Images 5 MB or less, JPEG or PNG only.
     Log requests without storing images.
   - CORS only for https://aarushgupta850.github.io and http://localhost:5173.
2. server/run_live.ps1: activate the venv, warm up the models with one dummy generation, start uvicorn on port 8000.
3. server/LIVE.md with two options:
   a. Cloudflare quick tunnel: cloudflared tunnel --url http://localhost:8000, then copy the
      https://....trycloudflare.com address into web/public/live.json and commit it.
      The address changes whenever the tunnel restarts, so it must be recommitted then.
   b. A section to fill in if sponsor GPU credits are available.
4. pytest for the input validation and the busy/timeout responses (no GPU; mock the pipeline).

Done when: tests pass and http://localhost:8000/health works locally. Stop and summarize. Do not commit.
```

After
- [ ] /ship Live generation server, then merge once the check is green
- [ ] Run server/run_live.ps1, then in another terminal `cloudflared tunnel --url http://localhost:8000`
- [ ] Put the tunnel's https address into web/public/live.json as {"url": "https://..."} on a branch server/live-url, then /ship Point live.json at the tunnel and merge
- [ ] On the live site, type "a teapot" under Make your own and confirm a new lesson appears
- [ ] Stop the server for a moment and confirm the site shows the friendly offline note, then start it again
- [ ] Keep your PC awake and plugged in during judging if you want live generation to work (change the sleep settings)

### M3: feature freeze and release (7 PM)

Mode: Plan · Branch: release/v1 · Time: about 30 minutes, on a call with Jeff

Before
- [ ] It's 7 PM. Both of you stop starting new features.
- [ ] Every finished PR from both of you is merged. List anything still open.
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md. Create and use branch release/v1 from main.

Goal: main is complete, stable and ready for judging.
1. List every open PR and branch that isn't merged, and say whether each looks safe to merge (tests pass, scope).
2. Run all tests and the build. Fix any integration bugs with the smallest possible change, and note whose folder
   each fix touched.
3. Confirm web/public/live.json holds the current tunnel address (or is empty), and that the app shows the
   friendly offline note when the server is down.
4. Write a manual test checklist for two devices (a laptop and a tablet or phone) covering every screen.

Done when: checks pass. Print the open-PR list and the test checklist. Stop. Do not commit.
```

After
- [ ] Decide together which open PRs (if any) still get merged
- [ ] If there were fixes: /ship Release fixes and merge
- [ ] Both of you run the checklist on the live site, on two devices
- [ ] From here on: bug fixes only. Help Jeff with the write-up and video.

## Stretch, submission and troubleshooting

### A6 (stretch): Happy accidents

Mode: Plan · Branch: stretch/happy-accidents · Time: about 60 minutes

Before
- [ ] M3 is done and tested on two devices
- [ ] It's before 9:30 PM. If not, skip this.
- [ ] Live server running
- [ ] /clear, then /sync, Plan Mode on

```
Follow CLAUDE.md, web/CLAUDE.md and server/CLAUDE.md. Create and use branch stretch/happy-accidents.

Goal: when the user makes a big mistake while learning, the AI redraws the target around their mistake.
1. Live server: POST /regenerate {pack, canvasPng (base64)} conditions the line-art ControlNet on the user's
   current canvas plus the original prompt, builds a new pack, drops plan strokes the user has already covered
   (within 10 px), and returns the new Pack. Same safety limits as /generate.
2. Engine: export adoptPlan(teacher, newPack) in web/src/engine/real that swaps in the remaining steps without
   losing progress. Add a test.
3. Behind the URL flag ?happy=1 only: when a stroke scores below 0.35 and the live server is online, call
   /regenerate in the background, never blocking drawing, then crossfade to the new plan and show the toast
   "Nice, we've worked that into your drawing." Leave a short note for Jeff listing the UI hooks you added.

Done when: it works locally with ?happy=1 and everything works as before without the flag.
Stop and summarize. Do not commit.
```

After
- [ ] Without ?happy=1, nothing changed
- [ ] With it, a deliberately wrong ear gets worked into the drawing
- [ ] /ship Happy accidents behind a flag, merge, and decide with Jeff whether it goes in the video

### Submission checklist (both of you)

- [ ] The live link works on two different devices
- [ ] Live generation works through the tunnel, or the site shows the friendly offline note
- [ ] README has the "AI tools used" section; CREDITS lists every model with its license
- [ ] Real numbers are in the write-up and the video
- [ ] Demo video is under 3:00 and shows the "How this lesson was made" panel and live generation
- [ ] Submitted through the official portal (check the Discord for which one) by 10:30 PM EDT, with the project name, one-paragraph description, GitHub link, video and write-up
- [ ] The site stays live through Monday's 6 PM closing ceremony (People's Choice is voted then)

### Troubleshooting

(Empty in the original doc.)
