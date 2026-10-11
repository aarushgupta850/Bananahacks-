# Ghost Lines: write-up

Draft, 500 words or fewer. Replace each [X] with a real number from one of our own runs before submitting.

## The problem

Self-taught beginners mostly get proportions wrong: the head too big, the legs too short. They can't see
it, and a video tutorial can't see their drawing, so they practice the same mistakes without knowing whether
they're improving.

## What Ghost Lines does

Test, teach, retest, with measured proof.

1. **Test.** Copy a subject on your own for 45 seconds, with the reference beside the canvas, not under it.
2. **Weak spots.** Ghost Lines measures every part of your drawing against the target and picks the two or
   three biggest problems, for example "Head [X]% too big".
3. **Teach.** Faint ghost lines guide you step by step, big shapes first. Every stroke is checked as you draw.
   The guides slide and scale to follow where you're actually drawing, and the help fades from full lines to
   dots to check-ins as your accuracy rises, then comes back if you struggle.
4. **Retest and report.** You draw it once more, alone. The report card puts both drawings beside the target,
   with part boxes, scores and fixes marked improved or not yet. In our own run, the score
   went from [X] to [X].

## How it works

**Image AI builds every lesson.** For each subject, SDXL-Lightning draws four line-art drafts in 4 steps each.
The pipeline keeps the cleanest one, thins its lines to 1 px and traces them into strokes. OWLv2 finds and
labels the parts (head, ears, tail...), and the strokes are ordered the way an artist works: construction
shapes, outlines, structure, details. For photos, a line-art detector and the MistoLine ControlNet redraw the
photo cleanly first. The "How this lesson was made" panel shows every stage.

**The engine runs in your browser**, in plain TypeScript with no server:

- matching each stroke to its guide with Fréchet and Chamfer distances
- moving the guides toward your drawing with a rotation-limited Procrustes fit
- aligning your whole drawing to the target with ICP, so drawing smaller or off-center isn't counted as a
  mistake
- measuring each part's size, position, shape and tilt

Every number on screen comes from these measurements.

## How it's different

- [ShadowDraw](https://www.microsoft.com/en-us/research/?p=163221) (Microsoft Research, SIGGRAPH 2011)
  pioneered guide "shadows" under the pen, built from a database of photos. It was a research prototype that
  guides, but doesn't test you or measure improvement.
- [Guidart](https://apps.apple.com/app/id6756828260) offers lessons, AR tracing and AI feedback on an uploaded
  drawing; [Sketo](https://apps.apple.com/app/id6758549742) and
  [SketchCoach](https://apps.apple.com/app/id6766131873) critique a photo of your drawing after you finish.
  Their feedback comes after the drawing is done.

Ghost Lines closes the loop in one sitting: it measures you, teaches your specific weak spots live, stroke by
stroke, with guides that adapt to you, then measures you again. It's free, runs in the browser, and can make a lesson
for anything you type.

## What's next

A classroom mode: a teacher assigns a subject and sees each student's before and after, part by part, so
the class's practice targets each student's real mistakes.
