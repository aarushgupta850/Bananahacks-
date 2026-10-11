// The Teacher: runs one lesson. It checks every stroke against the current step's guides, moves the guides to
// follow where the user is actually drawing, and decides how much help to show (Guided, Hints, Check-in).
import type {
  Ghost, HelpLevel, Mode, ModeChange, Pack, PlanStroke, Point, Step, StrokeResult, Teacher, UserStroke,
} from '../types'
import { config } from './config'
import {
  applyToAll, bbox, diagonal, IDENTITY, invertTransform, lerpTransform, procrustes, type Transform,
} from './geometry'
import { matchStroke } from './match'

// Help levels from most help to least. Auto mode moves one place along this list at a time.
const LEVELS: HelpLevel[] = ['guided', 'hints', 'checkin']

// The diagonal of everything the lesson draws. Distances are judged relative to it.
export function planDiagonal(pack: Pack): number {
  return diagonal(bbox(pack.strokes.flatMap((s) => s.points)))
}

export function createTeacher(pack: Pack, steps: Step[], startMode: Mode): Teacher {
  const plan = new Map(pack.strokes.map((s) => [s.id, s]))
  const partLabel = new Map(pack.parts.map((p) => [p.id, p.label.toLowerCase()]))
  // Steps that draw nothing (unknown stroke ids) would block the lesson, so they're dropped.
  const lesson = steps
    .map((step) => ({ step, strokes: step.strokeIds.map((id) => plan.get(id)).filter((s): s is PlanStroke => !!s) }))
    .filter((entry) => entry.strokes.length > 0)
  const baseDiagonal = planDiagonal(pack) || pack.size

  let mode: Mode = startMode
  let helpLevel: HelpLevel = startMode === 'auto' ? 'guided' : startMode
  let transform: Transform = { ...IDENTITY } // plan space -> where the user is drawing
  let pairs: { from: Point; to: Point }[] = [] // matched plan point -> user point, for the fit
  const done = new Set<string>()             // plan stroke ids drawn well enough
  const recent: number[] = []                // accuracies of the last few matched strokes
  const changes: ModeChange[] = []
  let strokeCount = 0
  let lastChangeAt = 0
  let lastAccuracy: number | null = null

  // ---------- helpers ----------

  // The first step that still has an undrawn guide (steps.length when the lesson is done).
  const stepIndex = () => lesson.findIndex((entry) => entry.strokes.some((s) => !done.has(s.id)))
  const currentIndex = () => {
    const i = stepIndex()
    return i === -1 ? lesson.length : i
  }
  const adapted = (points: Point[]) => applyToAll(transform, points)

  // The guides on screen: the current step's undrawn strokes, plus the next step's when the current step
  // is a single stroke (so the user can see where the line is heading).
  function shownStrokes(): PlanStroke[] {
    const i = currentIndex()
    if (i >= lesson.length) return []
    const remaining = lesson[i].strokes.filter((s) => !done.has(s.id))
    const next = lesson[i].strokes.length === 1 && lesson[i + 1] ? lesson[i + 1].strokes.filter((s) => !done.has(s.id)) : []
    return [...remaining, ...next]
  }

  function ghostsFor(strokes: PlanStroke[], level: HelpLevel): Ghost[] {
    if (level === 'checkin') return []
    return strokes.map((s): Ghost => {
      // Construction shapes are always drawn dashed, as helper shapes.
      if (s.tier === 'construction') return { strokeId: s.id, kind: 'construction', points: adapted(s.points) }
      if (level === 'guided') return { strokeId: s.id, kind: 'stroke', points: adapted(s.points) }
      // Hints: only the key points to connect (a stroke without key points gets its two ends).
      const dots = s.keyPoints.length > 0 ? s.keyPoints : [s.points[0], s.points[s.points.length - 1]]
      return { strokeId: s.id, kind: 'keypoints', points: adapted(dots) }
    })
  }

  function setHelpLevel(next: HelpLevel) {
    if (next === helpLevel) return
    changes.push({ atStroke: strokeCount, from: helpLevel, to: next })
    helpLevel = next
    lastChangeAt = strokeCount
  }

  // Auto mode: less help when the last few matched strokes average above 0.80, more below 0.60,
  // with at least 3 strokes between changes so the help doesn't flicker.
  function autoAdjust() {
    if (mode !== 'auto' || recent.length < config.autoMinStrokesBetween) return
    if (strokeCount - lastChangeAt < config.autoMinStrokesBetween) return
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length
    const at = LEVELS.indexOf(helpLevel)
    if (mean > config.autoFadeAbove && at < LEVELS.length - 1) setHelpLevel(LEVELS[at + 1])
    else if (mean < config.autoHelpBelow && at > 0) setHelpLevel(LEVELS[at - 1])
  }

  // Moves the guides toward where the user draws: fit plan -> user over all matched points so far
  // (rotation limited to 10 degrees), then go 60% of the way there, so one wobbly stroke can't throw them off.
  function adapt(guide: Point[], user: Point[]) {
    const back = invertTransform(transform)
    const planPoints = applyToAll(back, guide) // the guide as it is in the plan, before adapting
    pairs.push(...planPoints.map((from, i) => ({ from, to: user[i] })))
    if (pairs.length > config.adaptMaxPairs) pairs = pairs.slice(-config.adaptMaxPairs)
    const fit = procrustes(pairs, config.adaptMaxRotationDeg)
    transform = lerpTransform(transform, fit, config.adaptBlend)
  }

  // A gentle warning when a stroke is much bigger or smaller than its guide, e.g. "The head is getting large".
  function sizeWarning(strokeId: string, user: Point[], guide: Point[]): string | undefined {
    const partId = plan.get(strokeId)?.partId
    const guideSize = diagonal(bbox(guide))
    if (!partId || guideSize < 20) return undefined // tiny guides (dots, short ticks) give no reliable size
    const ratio = diagonal(bbox(user)) / guideSize
    const name = partLabel.get(partId) ?? 'part'
    if (ratio > 1 + config.warnSizeRatio) return `The ${name} is getting large. Try keeping it closer to the guide.`
    if (ratio < 1 - config.warnSizeRatio) return `The ${name} is getting small. Try making it a bit bigger.`
    return undefined
  }

  function state(): StrokeResult {
    const i = currentIndex()
    return {
      accuracy: lastAccuracy,
      completedStepIds: lesson.slice(0, i).map((entry) => entry.step.id),
      currentStepId: i < lesson.length ? lesson[i].step.id : null,
      ghosts: ghostsFor(shownStrokes(), helpLevel),
      helpLevel,
      done: i >= lesson.length,
    }
  }

  // ---------- the Teacher ----------

  return {
    addStroke(stroke: UserStroke): StrokeResult {
      if (stroke.points.length < 2) return state() // a tap, not a line: ignore it
      strokeCount++
      const userPoints = stroke.points.map(([x, y]): Point => [x, y])
      const candidates = shownStrokes().map((s) => ({ id: s.id, points: adapted(s.points) }))
      const match = matchStroke(userPoints, candidates, baseDiagonal * transform.scale)

      let warning: string | undefined
      if (match) {
        lastAccuracy = match.accuracy
        if (match.accuracy >= config.doneThreshold) done.add(match.ghostId)
        warning = sizeWarning(match.ghostId, match.user, match.guide)
        // A stroke with zero accuracy is too far off its guide to say where the user is drawing.
        if (match.accuracy > 0) adapt(match.guide, match.user)
        recent.push(match.accuracy)
        if (recent.length > config.autoWindow) recent.shift()
      } else {
        lastAccuracy = null // matched no guide: no score, no penalty
      }
      autoAdjust()
      const result = state()
      return warning ? { ...result, warning } : result
    },

    setMode(next: Mode): StrokeResult {
      mode = next
      if (next !== 'auto') setHelpLevel(next)
      return state()
    },

    // "Show me": the current step's full guides, wherever the user is drawing, at any help level.
    showMe(): Ghost[] {
      return ghostsFor(shownStrokes(), 'guided')
    },

    state,

    history(): ModeChange[] {
      return changes.map((c) => ({ ...c }))
    },
  }
}
