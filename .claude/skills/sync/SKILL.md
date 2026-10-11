---
name: sync
description: Merge the latest main into the current branch and re-run checks. Use before each new prompt and before merging.
disable-model-invocation: true
---

1. git fetch origin, then git merge origin/main into the current branch.
2. On conflicts: in files this person owns, merge carefully keeping both sides' intent;
   in files they don't own (see CLAUDE.md), keep main's version. List every conflict and how it was resolved.
3. In web/: run npm install if package-lock.json changed, then npm test -- --run.
4. Summarize what came in from main (one line per commit).
