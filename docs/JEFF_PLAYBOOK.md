# Jeff's playbook (UI half)

Everything Jeff builds: the canvas, every screen, the report, the "How this lesson was made" panel,
polish, the docs and the demo video. This file exists so a fresh Claude session (local or cloud) has the
full context. The shared rules live in `CLAUDE.md` and `web/CLAUDE.md`. Read those first, because every
prompt below assumes them.

- Repo: aarushgupta850/Bananahacks-. Live site: https://aarushgupta850.github.io/Bananahacks-/
- Jeff's folders: `web/src/screens`, `web/src/canvas`, `web/src/styles`, `web/src/App.tsx`, `web/index.html`.
  Don't edit Aarush's folders (`web/src/engine/real`, `web/src/engine/__tests__`, `web/src/dev`,
  `web/public/subjects`, `/server`).
- Build against the mock engine (`?engine=mock`), so nothing waits on Aarush.
- Never change `web/src/engine/types.ts` without Aarush agreeing first.

## Product spec for the UI

### Pitch and user

"Name or photograph anything. Ghost Lines tests how you draw it, teaches you with AI guides that adapt to
every stroke, then retests you, and proves you improved with real numbers."
The primary user is a beginner teaching themselves to draw, on a laptop or tablet.

### Design language

Paper #FAF7F2, ink #1C1B19, electric blue accent #3B6CFF (ghosts at 30% opacity), success #2E9E6A,
warning #F27A5E. Fraunces for headings, Inter for UI text. 12 px corners, 200 ms transitions, and
prefers-reduced-motion respected everywhere. Overlays never rely on color alone: label the user's boxes and
the target's boxes in text too. Must look good in a 1080p screen recording and work on laptop and iPad.

### Screens

1. **Choose a subject.** 8 ready-made subject cards (fox, cat, face, coffee mug, sneaker, house, bird, fish)
   and a difficulty picker (Simple / Medium / Detailed). "Make your own" lets the user type a subject or upload
   a photo. It shows "Live AI" when the generation server responds and a friendly offline message when it
   doesn't. Never show an error.
2. **Reference.** The large target drawing with the text "First, copy this as best you can. No help yet." and
   a "How this lesson was made" button.
3. **Test (solo, 45 s).** The reference sits beside the canvas, never on it. Countdown ring, Done and Skip,
   undo, clear, 3 pen sizes.
4. **Weak spots (about 5 s).** 2 or 3 findings with small visuals, plus one strength, and the text
   "Your lesson starts with these."
5. **Teach (2 min max).** Step label above the canvas, ghosts animating in, every stroke checked instantly,
   guides that adapt, an accuracy meter and a help-level indicator. "Show me" reveals the current step's
   ghosts for 3 s. Also a "Skip to retest" button.

   | Mode | What the user sees |
   |---|---|
   | Guided | Full ghost strokes for the next 1 to 3 steps |
   | Hints | Only key points and construction shapes; the user connects them |
   | Check-in | Nothing unless they press Hint; gentle warnings on big mistakes |
   | Auto (default) | Fades Guided → Hints → Check-in as accuracy rises above 0.80, and steps back below 0.60 (the engine decides this) |

6. **Retest (solo, 45 s).** Same as the test.
7. **Report card.** Test, retest and target side by side; toggleable, labeled part-box overlays; animated
   score with an improvement badge; 3 "fix this" and 2 "already good" items marked improved or not yet; mode
   history; 4× replay; Download report card; Try another subject; and "Level up" when the retest score is high.
8. **How this lesson was made.** The pipeline as a strip of stages: prompt or photo → 4 AI candidates
   (the chosen one highlighted) → traced skeleton → labeled parts → the ordered lesson animating stroke by
   stroke. This is the screen that protects the image-AI theme score, so **never cut it.**

Every number shown to users must come from the engine. Never invent one.

## Timeline (Sun Oct 11, 2026, EDT)

| When | What |
|---|---|
| Sat night, after Aarush says "the base is live" | Setup, J1a, J1b (or the overnight run) |
| 8 AM to 1 PM | J2a, J2b, J2c |
| About 1 PM | M1 integration call with Aarush; fix screen issues |
| 1 PM to 4:30 PM | J3, then J4 |
| About 4:30 PM | M2: draw 12 test drawings for engine tuning |
| 5 PM to 7 PM | J5 polish |
| 7 PM | M3 feature freeze; bug fixes only after this |
| 7 PM to 10:30 PM | J6 docs, record the video, submit |

If behind at 4 PM, cut replay, difficulty levels and Happy accidents. Never cut the pipeline panel.

What Jeff waits on from Aarush:

| Needed | Unblocks | Expected |
|---|---|---|
| Base site on main (B1 to B3: Vite app, `types.ts`, `mock.ts`, `DrawingCanvas.tsx`, demo fox) | J1a | Sat night |
| Real packs on main (A3) | J4, and real subjects in the screens | Sun about 1 PM |
| Real engine on main (A4d) | M2 test drawings | Sun about 4:30 PM |
| Live server and tunnel (A5) | Live generation in the video | Sun about 7 PM |

## Overnight cloud run (optional)

Requirements: the base is on main, and Aarush has installed the Claude GitHub app on the repo (only the repo
owner can). Paste this, then the prompts J1a, J1b, J2a, J2b, J2c and J3 below, in order:

```
OVERNIGHT RUN. Follow CLAUDE.md and web/CLAUDE.md, with ONE exception for this run only: after each prompt you
may do the shipping steps yourself (npm test -- --run, npm run build, commit only the files you changed, push the
branch, open or update the PR). Never merge anything. Never push to main. Never edit web/src/engine/types.ts.

Before starting: confirm main contains web/src/engine/types.ts, web/src/engine/mock.ts and
web/src/canvas/DrawingCanvas.tsx. If any is missing, stop and write why.

Run the prompts below in order, treating each one as a fresh task:
1. J1a, then J1b, on branch web/canvas created from main. PR title: "Canvas, ghost lines, replay".
2. J2a, J2b, J2c on branch web/screens created FROM web/canvas (not main). PR title: "Flow screens".
3. J3 on branch web/report created FROM web/screens. PR title: "Report card".
These branch rules override the branch names written inside the prompts.

After each prompt, run the tests and build. If either fails twice in a row, stop there and write what failed.
In every PR description, list each "Done when" item that needs a human to check in a browser.
Stop after J3.
```

Sunday morning: review the PRs in order (web/canvas, web/screens, web/report), run each one locally against
its human checks below, fix anything with short prompts, then merge in that order.

## Prompts

Run each one in a fresh session (`/clear`, then `/sync`). Prompts marked Plan start in Plan Mode.

### J1a: the drawing canvas (Plan, about 40 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/canvas.
Only edit web/src/canvas and web/src/App.tsx (web/src/dev belongs to Aarush).

Goal: drawing feels smooth and natural with mouse, touch and stylus.

Polish web/src/canvas/DrawingCanvas.tsx:
- pointer capture; pressure support; when a pen is detected, ignore touch input (palm rejection)
- high-DPI rendering, smoothed strokes with perfect-freehand, 3 pen sizes
- undo and clear, exposed through props or a ref
- a subtle paper texture made with CSS (no large images)
- the canvas stays square and scales to fit its container
- strokes stored as UserStroke in 768 x 768 space: [x, y, pressure, ms since stroke start], as in types.ts
Add a demo page web/src/canvas/CanvasDemo.tsx that uses the demo fox pack, opened from App.tsx when the URL has
?debug=canvas.

Done when: drawing is smooth on ?debug=canvas, undo and clear work, and tests and build pass.
Stop and summarize. Do not commit.
```

Human checks: strokes look smooth with a mouse (try a finger on a tablet too); undo removes the last stroke and
clear removes all; the canvas stays square when the window is resized. Then `/ship Polished drawing canvas`.

### J1b: ghost lines, replay and stroke export (Plan, about 40 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch web/canvas.
Only edit web/src/canvas and web/src/App.tsx.

Goal: ghost lines that feel alive, a replay player, and a way to export real drawings for testing.

1. web/src/canvas/GhostLayer.tsx (SVG overlay, pointer-events none):
   - ghost strokes in the accent color at 30% opacity, with a 400 ms "drawing on" animation (stroke-dashoffset)
   - kind keypoints: small dots; kind construction: dashed lines
   - ghosts that disappear (completed) fade out over 200 ms
   - under prefers-reduced-motion: no animation, they simply appear
2. web/src/canvas/ReplayPlayer.tsx: plays a recording
   { events: { t: number; type: 'stroke' | 'ghosts'; stroke?: UserStroke; ghosts?: Ghost[] }[] }
   at 4x speed, with play, pause and restart buttons.
3. A dev-only "Export strokes" button, shown only when the URL has ?dev=1, that downloads the canvas strokes
   as a JSON file. Aarush uses these files to test the engine.
4. Show all three on the ?debug=canvas page.

Done when: ghosts animate smoothly, replay plays a recorded sample, export downloads valid JSON,
and tests and build pass. Stop and summarize. Do not commit.
```

Human checks: ghosts draw themselves in and fade when completed; replay plays at 4×; `?debug=canvas&dev=1` shows
the export button and the file opens as JSON. Then `/ship Ghost lines, replay player and stroke export` and merge
web/canvas.

### J2a: subject picker and reference (Plan, about 60 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/screens.
Only edit web/src/screens, web/src/styles and web/src/App.tsx.
Use engine from web/src/engine/index.ts and the helpers in web/src/lib/packs.ts and web/src/lib/live.ts.

Goal: the first two screens, fully designed.

1. SubjectPicker:
   - cards from subjects/index.json: thumbnail, title, and a small "AI-generated" badge
   - a difficulty segmented control (Simple / Medium / Detailed) showing only the difficulties that subject has
     (the keys of its packs map)
   - "Make your own": a text input and a photo upload. On load, call checkLive().
     Online: inputs enabled, with a "Live AI" badge. Offline: inputs disabled, with the note
     "Live generation is offline right now. Pick a ready-made subject above!" Never show an error.
   - while generating: a loading animation of lines sketching themselves. On a timeout or a busy server,
     a friendly message suggesting a ready-made subject.
2. Reference: the target image large, the subject name, the text "First, copy this as best you can. No help yet.",
   a "Start test" button, and a "How this lesson was made" button that opens the PipelinePanel modal
   (still a placeholder; J4 builds it).

Done when: both screens look polished at 1920x1080 and at iPad size, and tests and build pass.
Stop and summarize. Do not commit.
```

Human checks: picking a subject and difficulty leads to its reference; with no live server the offline note
shows and the console has no red errors; looks right at iPad size. Then `/ship Subject picker and reference screens`.

### J2b: test, retest and weak spots (Plan, about 50 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch web/screens.
Only edit web/src/screens, web/src/styles and web/src/App.tsx.

Goal: the solo drawing screens and the weak-spots summary.

1. Test and Retest (one shared component with a prop):
   - the reference image BESIDE the canvas, never on it: side by side on wide screens, stacked on narrow ones
   - a 45-second countdown ring, plus Done and Skip buttons
   - undo, clear and pen-size controls
   - when finished: engine.analyze(pack, strokes), stored in the session (testAnalysis or retestAnalysis)
2. WeakSpots:
   - engine.findWeaknesses(pack, testAnalysis) -> 2 or 3 cards, each with a small visual comparing the target's
     part box with the user's box from the analysis, plus one card for a strength
   - the text "Your lesson starts with these."
   - auto-advance after 5 seconds, or on tap

Done when: Test -> Weak spots -> (Teach placeholder) -> Retest works with ?engine=mock, and tests and build pass.
Stop and summarize. Do not commit.
```

Human checks: with `?engine=mock` the test ends on its own at 0; weak-spot cards use words plus a visual, never
color alone; the reference never overlaps the canvas at any size. Then `/ship Test, retest and weak spots screens`.

### J2c: the teaching screen (Plan, about 60 min)

This is the screen judges will remember, so give it the most care.

```
Follow CLAUDE.md and web/CLAUDE.md. Stay on branch web/screens.
Only edit web/src/screens, web/src/styles and web/src/App.tsx.

Goal: the Teach screen, where adaptive ghost lines guide the user.

- steps = engine.buildLesson(pack, weaknesses); teacher = engine.createTeacher(pack, steps, 'auto').
- On every finished stroke, call teacher.addStroke(stroke) and update:
  the ghosts (GhostLayer), a smoothed live accuracy meter, a help-level pill (Guided / Hints / Check-in),
  the current step's label and tip above the canvas, and a gentle toast when a warning comes back.
- A mode selector (Auto / Guided / Hints / Check-in) that calls teacher.setMode().
- "Show me" displays teacher.showMe() ghosts for 3 seconds. A "Skip to retest" button.
- The session ends when the result says done, or after 2 minutes.
- Record the session in the ReplayPlayer format (a stroke event per stroke, plus a ghosts event with the ghosts
  after each stroke), and store it and teacher.history() in the session.

Done when: the full flow, Subject -> Reference -> Test -> Weak spots -> Teach -> Retest -> Report placeholder,
clicks through end to end with ?engine=mock, and tests and build pass. Stop and summarize. Do not commit.
```

Human checks: with `?engine=mock`, ghosts update after every stroke and the help pill goes from Guided to Hints in
Auto; Check-in shows no ghosts until "Show me"; the whole flow clicks through without errors. Then
`/ship Teaching screen with adaptive guides`, merge web/screens, and tell Aarush "Screens are on main."

### M1 fixes (Direct, about 1 PM)

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/fixes.
Fix these issues found when the real packs were merged into the screens:
<paste Aarush's list>
Stop and summarize. Do not commit.
```

### J3: the report card (Plan, about 75 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/report from main.
Only edit web/src/screens, web/src/styles and web/src/App.tsx.

Goal: a report card that proves the user improved, with real numbers.

1. Three drawings side by side: Test, Retest, Target (strokes drawn read-only; the target as its image).
   Stacked on narrow screens.
2. Overlay toggle showing part boxes: the target's (pack.parts) and the user's (analysis.parts[].userBox),
   in different colors AND with text labels ("your head", "target head").
3. Scores: engine.score() for the test and the retest, an animated count-up (none under reduced motion),
   a large improvement badge such as "+31", and small bars for proportion, shape and line.
4. Coaching: engine.coach(pack, testAnalysis, retestAnalysis): 3 "fix this" items marked improved or not yet,
   and 2 "already good" items.
5. When overallScale is below 0.85 or above 1.15, a note like "Drew 30% smaller than the target
   (not counted against you)".
6. The mode history in words, built from the recorded history: "Auto: Guided -> Hints after stroke 9".
7. The ReplayPlayer showing the teaching session.
8. Buttons: "Download report card" (html-to-image PNG of a compact card with the title, the three drawings,
   the scores and the app name), "Level up" (shown when the retest total is at least 75 and a harder difficulty
   exists; starts that difficulty), and "Try another subject".

Done when: the report works with ?engine=mock, the PNG downloads and looks good, and tests and build pass.
Stop and summarize. Do not commit.
```

Human checks: scores count up and the badge shows the improvement; the overlay shows both sets of boxes with text
labels; the PNG looks good enough to share. Then `/ship Report card` and merge.

### J4: "How this lesson was made" (Plan, about 60 min)

Needs Aarush's real packs on main (they contain the pipeline images). Look at
`web/public/subjects/fox-medium/pack.json` first to see its `pipeline` list. Make this the most polished screen
in the app.

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/pipeline-panel from main.
Only edit web/src/screens, web/src/styles and web/src/App.tsx.

Goal: a panel that shows how image AI created each lesson.

1. PipelinePanel (modal or full-screen sheet): a horizontal strip of stages from pack.pipeline, with scroll-snap,
   arrow buttons and keyboard arrows. Each stage shows its image(s) and a plain-English caption:
   source (prompt text, or the photo for photo packs) -> candidates (4 AI drafts; highlight the one whose path
   equals the chosen stage's image) -> chosen drawing -> skeleton (lines traced to 1 px) -> parts found
   (labeled boxes) -> order ("Your lesson").
2. The order stage is live, not an image: pack.strokes animate in plan order, numbered and colored by tier.
3. A small legend for the tiers: construction -> outlines -> structure -> details.
4. An intro line at the top: "Every lesson is created by image AI: generated, traced, labeled and ordered
   the way an artist would draw it."
5. Opens from the Reference screen and the Report. Resolve image paths with resolveAsset, so relative paths
   and data: URLs (live packs) both work. Stages without images (like the demo fox) show text only.

Done when: the panel works for every real pack, and tests and build pass. Stop and summarize. Do not commit.
```

Human checks: every real pack shows all six stages with the chosen candidate highlighted; the lesson stage animates
in order; keyboard arrows move between stages. Then `/ship How this lesson was made panel` and merge.

### M2: test drawings (about 4:30 PM, no prompt)

Once the real engine is on main: for fox, face, mug and house at medium difficulty, draw three versions each
(careless 10 s, rough 30 s, careful) on the Test screen with `?dev=1`, press Export strokes, and name the files
`fox-careless-jeff.json`, `fox-rough-jeff.json`, `fox-careful-jeff.json` and so on. Send all 12 to Aarush.

### J5a: polish pass (Plan, about 75 min)

```
Follow CLAUDE.md and web/CLAUDE.md. Create and use branch web/polish from main.
Only edit web/src/screens, web/src/canvas, web/src/styles, web/src/App.tsx and web/index.html.

Goal: the whole app looks and feels finished.
1. Consistent spacing, type scale and button styles on every screen. One primary button per screen.
   Smooth 200 ms transitions between screens.
2. Check layouts at 1920x1080, 1366x768, iPad portrait and landscape, and phone width (working, at minimum).
3. Accessibility: visible keyboard focus, aria-labels on icon buttons, alt text on every image,
   color never the only signal, prefers-reduced-motion respected everywhere.
4. An ErrorBoundary with a friendly "Something went wrong, start over" button that resets the session.
5. Page title, favicon, meta description and an Open Graph image.
6. Hide debug UI unless the URL has ?dev=1 or ?debug=...

Also fix these issues I noticed: <paste your notes, or delete this line>

Done when: build passes and every screen looks consistent at all sizes. List anything still rough.
Stop and summarize. Do not commit.
```

J5b quick fixes: short Direct prompts on web/polish, batched into one `/ship Polish fixes`. Merge before 7 PM.

### M3 (7 PM)

Feature freeze. Merge every finished PR, run Aarush's test checklist on the live site on two devices, and fix
screen bugs on a web/hotfix branch. Bug fixes only from here on.

### J6: README, write-up and video script (Plan, about 45 min)

Before running it, do one full run yourself and note your real numbers (the size error you fixed, and your
scores before and after).

```
Follow CLAUDE.md. Create and use branch docs/final from main. Read the whole repo first.

Goal: draft every written part of the submission. The team will review and add real numbers.

1. README.md: the pitch, a screenshot, the live link, "How it works" (the AI pipeline that builds each lesson;
   the in-browser engine that matches strokes, adapts the guides and measures improvement), setup in 3 commands
   or fewer, ownership, and "AI tools used" listing every AI tool used to write code or content, including Claude.
2. CREDITS.md: check that every model (SDXL base, SDXL-Lightning, the ControlNet, the line-art extractor, OWLv2,
   any LoRA), library and font is listed with its license and a link. Add what's missing.
3. docs/DESCRIPTION.md: the one-paragraph project description for the submission form.
4. docs/WRITEUP.md, 500 words or fewer: the problem (beginners misjudge proportions; tutorials can't see your
   drawing); what Ghost Lines does (test -> teach -> retest, with measured proof); how it works; how it differs
   from existing apps (name ShadowDraw, Sketo, Guidart and SketchCoach honestly, with links); what's next
   (a classroom mode for teachers). Use [X] placeholders wherever a real number goes.
5. docs/VIDEO.md: a shot list and voiceover script for a video under 3 minutes:
   0:00-0:20 the problem; 0:20-0:45 pick Fox and do the test; 0:45-1:00 weak spots;
   1:00-1:40 teaching (guides bend to the strokes, help fades); 1:40-2:00 retest and report;
   2:00-2:35 "How this lesson was made" and live generation of "a teapot";
   2:35-3:00 how it's different, and the teacher use case.

Done when: all five files are drafted. Stop and summarize. Do not commit.
```

Then replace every [X] with real numbers, have Aarush review "How it works", check the write-up is 500 words or
fewer, and run `/ship Submission docs`.

## Submission checklist (both)

- The live link works on two devices; live generation works or the friendly offline note shows.
- README has "AI tools used"; CREDITS lists every model with its license.
- Real numbers are in the write-up and the video; the video is under 3:00 and shows the pipeline panel and
  live generation.
- **The repo is public** (it is private as of Oct 10; the rules require a public repo).
- Submitted through the official portal by 10:30 PM EDT, with the name, description, GitHub link, video and
  write-up, and AI tools disclosed in the submission too.
- The site stays live through Monday's 6 PM closing ceremony.
