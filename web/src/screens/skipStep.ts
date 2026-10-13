// "Skip step": the app draws the current step for the user, then the lesson moves on to the next one.
// The teacher (the shared contract) has no skip call, so the step is drawn the way a user would draw it:
// every guide of the step, exactly where it is shown now, becomes a stroke. Strokes that sit right on the
// guides complete the step; for any guide the matcher can't follow, the engine's "never a dead end" rule
// (a step moves on after a few tries near it) finishes the job, so a skip always makes progress.
import type { Point, Step, StrokeResult, Teacher, TimedPoint, UserStroke } from '../engine/types'
import type { Mode } from '../engine/types'

// Rounds of drawing the step's guides before giving up (a round is usually enough; the engine's own limit
// for moving on is well below this).
const MAX_ROUNDS = 10

// A guide's points as a stroke: medium pressure, 16 ms apart, like a steady hand.
const asStroke = (points: Point[]): UserStroke => ({ points: points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })

export interface SkipResult {
  result: StrokeResult         // the teacher's state after the skip
  drawn: UserStroke[]          // the strokes drawn for the user (to show on the canvas)
  ignoreHistory: [number, number] // help-level changes [from, to) in teacher.history() caused by the skip itself
}

export function skipStep(teacher: Teacher, steps: Step[], mode: Mode): SkipResult {
  const before = teacher.state()
  const historyStart = teacher.history().length
  const step = steps.find((s) => s.id === before.currentStepId)
  if (!step || before.done) return { result: before, drawn: [], ignoreHistory: [historyStart, historyStart] }

  let result = before
  const drawn: UserStroke[] = []
  for (let round = 0; round < MAX_ROUNDS && result.currentStepId === step.id && !result.done; round++) {
    // showMe gives the full guides at any help level; keep only this step's (not the next step's preview).
    const guides = teacher.showMe().filter((g) => step.strokeIds.includes(g.strokeId) && g.points.length >= 2)
    if (guides.length === 0) break
    for (const guide of guides) {
      const stroke = asStroke(guide.points)
      drawn.push(stroke)
      result = teacher.addStroke(stroke)
      if (result.currentStepId !== step.id) break
    }
  }

  // Perfect strokes would make Auto fade the help, the opposite of what someone who skipped needs,
  // so Auto goes back to the help level it had before the skip.
  if (mode === 'auto' && result.helpLevel !== before.helpLevel) {
    teacher.setMode(before.helpLevel)
    result = teacher.setMode('auto')
  }
  return { result, drawn, ignoreHistory: [historyStart, teacher.history().length] }
}

/** The teacher counts every stroke it is given, the ones "Skip step" drew included. This turns its count `at` back
 * into the user's own strokes: `skips` holds, per skip, [the teacher's count before it, strokes it drew], and
 * `before` is the user's own strokes in earlier (redrawn) lessons, whose teachers counted from 0. */
export function ownStrokeNumber(at: number, skips: ReadonlyArray<readonly [number, number]>, before = 0): number {
  return before + at - skips.filter(([start]) => start < at).reduce((sum, [, n]) => sum + n, 0)
}
