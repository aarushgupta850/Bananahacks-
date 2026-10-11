---
name: build-pack
description: Build one subject pack with the GPU pipeline, validate it, and record QA.
disable-model-invocation: true
argument-hint: "[subject] [difficulty] [optional photo path]"
---

Build a pack for subject $0 at difficulty $1. Photo path (optional): $2

1. Activate server/.venv. Run python server/build_pack.py --subject $0 --difficulty $1,
   adding --photo <path> if a photo path was given, otherwise --prompt "$0".
2. If the quality gate fails, retry once with a new seed. If it fails again, stop and report.
3. Print the pack id, stroke count, step count, parts found and total folder size.
4. Print the inspector link: http://localhost:5173/Bananahacks-/?debug=pack&id=$0-$1
5. Append a row to server/PACK_QA.md: pack id | strokes | steps | parts | needs human check
6. Do not commit. The human checks the pack in the inspector first.
