# Ghost Lines: project memory

Hackathon project for Banana Hacks 2026 (theme: image AI). Deadline: Sun Oct 11, 11:59 PM EDT.
Two people work in parallel: Aarush and Jeff. Both are students who must explain the code to judges,
so keep code readable and comment any non-obvious logic.

## What the app does

A web app that teaches drawing: Choose subject -> Reference -> Test (copy it solo, 45 s) -> Weak spots
-> Teach (adaptive ghost-line guides, 4 assistance modes) -> Retest (solo, 45 s) -> Report (measured before/after).
A "How this lesson was made" panel shows the AI pipeline behind each subject.

- All app logic runs in the browser. The site is static on GitHub Pages.
- Subject packs (images + pack.json) are built offline by the Python GPU pipeline in /server
  and committed to /web/public/subjects.
- An optional live generation server (server/api.py) runs through a tunnel. The app must work fully without it.

## Layout and ownership

- web/src/screens, web/src/canvas, web/src/styles, web/src/App.tsx: Jeff
- web/src/engine/real, web/src/engine/__tests__, web/src/dev, web/public/subjects, /server: Aarush
- web/src/engine/types.ts: the shared CONTRACT (see below)
- web/src/engine/mock.ts, web/src/engine/index.ts, web/src/lib: shared, change with care
- Only edit files you own. If a change elsewhere is unavoidable, keep it minimal and mention it in the PR.

## The contract

- web/src/engine/types.ts defines Pack, UserStroke, Engine, Teacher, Analysis and friends. Both halves build against it.
- Never change types.ts unless the human explicitly approves. Log every change in CONTRACT_CHANGES.md.
- All coordinates are in a 768 x 768 target space.
- UI code calls only `engine` from web/src/engine/index.ts. The URL flag ?engine=mock forces the mock engine.

## Commands

- Web: cd web, then npm run dev (http://localhost:5173/Bananahacks-/), npm test -- --run, npm run build
- Server: activate server/.venv, then pytest server
- Dev pages: ?debug=pack&id=<packId> (pack inspector), ?debug=canvas (canvas test), ?dev=1 (export strokes)

## Git workflow

- main always deploys to GitHub Pages and must always work.
- One short-lived branch per prompt: web/<thing>, engine/<thing>, server/<thing>, packs/<thing>.
- Finish every task with tests and build passing. Do not commit: stop and summarize, and the human runs /ship.
- Commit small and often. Judges check that commits happened during the event.

## Never

- Never commit model weights, .env, server/out, server/cache or node_modules.
- Never add a dependency without explaining why in your summary.
- Never push directly to main.
- Never show users a number that engine code did not compute.

## Hackathon rules

- All code is written during the event (after Fri Oct 9, 8 PM EDT) in this public repo.
- Credit every model, library, dataset and font in CREDITS.md, with its license.
- AI tools are allowed but must be listed in README under "AI tools used".
