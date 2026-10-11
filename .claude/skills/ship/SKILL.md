---
name: ship
description: Test, commit, push and open a pull request for the current branch. Use when a task is finished.
disable-model-invocation: true
argument-hint: "[one-line summary of the change]"
---

Ship the current work. Summary from the user: $ARGUMENTS

1. Run git status. If the branch is main, stop and ask which branch to create.
2. Run checks for what changed. Anything under web/ changed: in web/, run npm test -- --run, then npm run build.
   Anything under server/ changed: run pytest server. If a check fails, try to fix it at most twice; otherwise stop and report.
3. Stage only files in folders this person owns (see CLAUDE.md). Never stage weights, .env, server/out or server/cache.
4. Commit. First line: what changed (72 characters or less). Body: why, in 1-3 plain sentences a judge could follow.
5. git push -u origin <branch>
6. If the gh CLI is installed, run gh pr create --fill. Otherwise print
   https://github.com/aarushgupta850/Bananahacks-/compare/<branch>
7. Report: branch, commit, checks run, PR link.
