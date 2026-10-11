# Ghost Lines: write-up

## The problem

Self-taught beginners mostly get proportions wrong: the head too big, the legs too short. They can't see
it, and a video tutorial can't see their drawing, so they repeat the same mistakes without knowing if
they're improving.

## What Ghost Lines does

Test, teach, retest, with measured proof.

1. **Test.** Copy a subject on your own for 45 seconds, with the reference beside the canvas, not under it.
2. **Weak spots.** It measures every part against the target and picks the two or three biggest
   problems, like "Head 36% too big" and "Ears 86% too small" on one of our foxes.
3. **Teach.** Faint ghost lines guide you step by step, big shapes first, and every stroke is checked as you
   draw. The guides follow your drawing, and the help fades from full lines to dots to check-ins as you
   improve, then comes back if you struggle.
4. **Retest and report.** You draw it once more, alone. The report card shows both drawings beside the target,
   with scores and each fix marked improved or not yet. Our own run: [our run: test → retest].

## How it works

**Image AI builds every lesson.** SDXL-Lightning draws four line-art drafts. The pipeline keeps the cleanest,
thins its lines to 1 px and traces them into strokes. You copy that drawing itself, cleaned to black on white;
the guides and scores use its traced strokes. OWLv2 labels the parts, and the strokes are ordered the way an
artist works: construction shapes, outlines, structure, details. The "How this lesson was made" panel shows
every stage.

**Live lessons.** With our GPU server online, any typed subject or photo becomes a lesson in about 15 to
20 seconds. A detector turns photos into line art, then SDXL-Lightning img2img redraws it cleanly.
Prompts pass a blocklist that catches disguised words, pictures are checked for nudity and weapons with
OWLv2, and photos are never stored.

**The engine runs in your browser**, in plain TypeScript:

- Fréchet and Chamfer distances match each stroke to its guide
- a rotation-limited Procrustes fit moves the guides toward your drawing
- ICP aligns your whole drawing to the target, so drawing smaller or off-center isn't a mistake
- then each part's size, position, shape and tilt is measured

Every number on screen comes from these measurements. Our three 45-second foxes, drawn carefully, roughly and
carelessly, score 81, 79 and 37.

## How it's different

- [ShadowDraw](https://www.microsoft.com/en-us/research/?p=163221) (Microsoft Research, SIGGRAPH 2011)
  pioneered guide "shadows" under the pen, but doesn't test you or measure improvement.
- [Guidart](https://apps.apple.com/app/id6756828260), [Sketo](https://apps.apple.com/app/id6758549742) and
  [SketchCoach](https://apps.apple.com/app/id6766131873) give AI feedback on your drawing once it's finished
  (Guidart also has lessons and AR tracing).

Ghost Lines closes the loop in one sitting: it measures you, teaches your weak spots live with adaptive
guides, then measures you again. It's free and runs in the browser.

## What's next

A classroom mode: a teacher assigns a subject and sees each student's before and after, part by part.
