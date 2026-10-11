// The Teacher: runs one lesson. It checks every stroke against the current step's guides, moves the guides to
// follow where the user is actually drawing, and decides how much help to show (Guided, Hints, Check-in).
import type {
  Ghost, HelpLevel, Mode, ModeChange, Pack, PlanStroke, Point, Step, StrokeResult, Teacher, UserStroke,
} from '../types'
import { config } from './config'
import {
  applyToAll, bbox, clamp, diagonal, IDENTITY, invertTransform, isClosed, length, lerpTransform, PointGrid, procrustes,
  resample, type Transform,
} from './geometry'
import { coverageShare, isTap, matchStroke } from './match'

const isIdentity = (t: Transform) => t.scale === 1 && t.rotation === 0 && t.tx === 0 && t.ty === 0

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
  const covered = new Map<string, Set<number>>() // plan stroke id -> guide points traced well so far (see match.ts)
  const recent: number[] = []                // accuracies of the last few matched strokes
  const changes: ModeChange[] = []
  let strokeCount = 0
  let lastChangeAt = 0
  let lastAccuracy: number | null = null
  let triesOnStep = 0                        // strokes drawn near the current step's guides without finishing it
  let triesStep = -1                         // which step triesOnStep counts for

  // A guide with no length (a single point, or all its points in one spot) can't be traced: any line drawn over
  // it is longer than the guide, and a dot is a tap, which is ignored. Such guides (possible in generated packs)
  // count as drawn from the start, so they never block a step.
  for (const { strokes } of lesson) {
    for (const s of strokes) if (s.points.length < 2 || length(s.points) < config.minStrokeLength) done.add(s.id)
  }

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
    const next = lerpTransform(transform, fit, config.adaptBlend)
    // Adapting must bring the guide closer to this stroke. A stroke matched to the wrong stretch (e.g. one long
    // line over several guides) can pair points badly and make a fit that moves the guides away: skip that one.
    const gap = (t: Transform) => planPoints.reduce((sum, p, i) => {
      const [x, y] = applyToAll(t, [p])[0]
      return sum + Math.hypot(x - user[i][0], y - user[i][1])
    }, 0)
    if (gap(next) <= 1.1 * gap(transform)) transform = next // a little worse is fine: the fit uses earlier strokes too
    else pairs.splice(pairs.length - planPoints.length, planPoints.length)
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

  // Which sample points of each shown guide a stroke passed close to (the same points match.ts uses, so the two
  // kinds of coverage add up). This credits a stroke that runs along two guides at once (a whole outline in one
  // go), one drawn backwards, or one in a different order. Also returns how close the stroke stayed to the guides.
  function coverByCloseness(userPoints: Point[], candidates: { id: string; points: Point[] }[]) {
    const tolerance = config.coverDistance * baseDiagonal * transform.scale
    const user = resample(userPoints, 2 * config.guidePoints)
    const guides = candidates.map((c) => ({ id: c.id, closed: isClosed(c.points), points: resample(c.points, config.guidePoints) }))
    const guidePoints = guides.flatMap((g) => g.points)
    // Grids make "closest point" lookups fast (a few cells instead of every point), keeping addStroke quick.
    const cellSize = Math.max(tolerance, 8)
    const userGrid = new PointGrid(user, cellSize)
    const guideGrid = new PointGrid(guidePoints, cellSize)
    const distanceTo = (p: Point, grid: PointGrid) => {
      const q = grid.nearest(p)
      return q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity
    }
    const byGuide = new Map<string, number[]>()
    for (const g of guides) {
      // A closed guide's last point is its first point again.
      const hits = g.points.flatMap((p, i) => (distanceTo(p, userGrid) <= tolerance ? [g.closed && i === g.points.length - 1 ? 0 : i] : []))
      if (hits.length > 0) byGuide.set(g.id, hits)
    }
    // Share of the stroke that stayed on the guides (a stroke mostly off them earns no credit), and a score
    // from its average distance to them, on the same scale as match.ts's accuracy.
    const distances = user.map((p) => distanceTo(p, guideGrid))
    const onGuides = distances.filter((d) => d <= tolerance).length / user.length
    const mean = guidePoints.length > 0 ? distances.reduce((sum, d) => sum + d, 0) / user.length : Infinity
    const accuracy = clamp(1 - mean / (config.accuracyScale * baseDiagonal * transform.scale), 0, 1)
    return { byGuide, onGuides, accuracy }
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
      const userPoints = stroke.points.map(([x, y]): Point => [x, y])
      if (userPoints.length < 2 || isTap(userPoints)) return state() // a tap, not a line: ignore it
      strokeCount++
      // The shown guides where they are now (adapted to the user), the stroke's best match among them, and which
      // guide points it passed close to.
      const look = () => {
        const shown = shownStrokes().map((s) => ({ id: s.id, points: adapted(s.points) }))
        return {
          match: matchStroke(userPoints, shown, baseDiagonal * transform.scale),
          closeness: coverByCloseness(userPoints, shown),
        }
      }
      let { match, closeness } = look()
      // Self-repair: if the stroke is nowhere near the adapted guides but is near the guides' original places,
      // the adaptation has drifted away from where the user draws (e.g. after one odd stroke). Without this the
      // user could never match a guide again (and in Check-in they can't even see where the guides went), so
      // the guides go back to their original places and the stroke is judged again.
      const lost = !match && closeness.byGuide.size === 0 && closeness.accuracy === 0
      if (lost && !isIdentity(transform)) {
        const original = shownStrokes().map((s) => ({ id: s.id, points: s.points }))
        if (matchStroke(userPoints, original, baseDiagonal) || coverByCloseness(userPoints, original).byGuide.size > 0) {
          transform = { ...IDENTITY }
          pairs = []
          ;({ match, closeness } = look())
        }
      }

      const stepAtStart = currentIndex()
      const credit = (id: string, indices: number[]) => {
        const traced = covered.get(id) ?? new Set<number>()
        indices.forEach((i) => traced.add(i))
        covered.set(id, traced)
        // The guide is drawn once most of it is covered, by one stroke or several (a long outline in pieces).
        if (coverageShare(traced, plan.get(id)?.points ?? []) >= config.doneCoverage) done.add(id)
      }

      // Every guide point the stroke passed close to counts, if most of the stroke stayed on the guides.
      const onTheGuides = closeness.onGuides >= config.doneCoverage
      if (onTheGuides) closeness.byGuide.forEach((indices, id) => credit(id, indices))

      let warning: string | undefined
      if (match) {
        // A stroke that stays on the guides scores at least that well, even when it spans two of them and so
        // matches neither guide on its own.
        lastAccuracy = onTheGuides ? Math.max(match.accuracy, closeness.accuracy) : match.accuracy
        // A good stroke also covers the stretch of the guide it was matched to.
        if (match.accuracy >= config.doneThreshold) credit(match.ghostId, match.covered)
        warning = sizeWarning(match.ghostId, match.user, match.guide)
        // A stroke with zero accuracy is too far off its guide to say where the user is drawing, and a dot or
        // a short tick is too small to say how big the user is drawing.
        // A stroke that ran along several guides at once can't be paired point by point with the one it matched,
        // and pairing it anyway would pull the guides away from the user, so it doesn't move them.
        // ("Ran along" = passed close to at least a quarter of another guide; brushing past its end doesn't count.)
        const spansGuides = [...closeness.byGuide].some(([id, hits]) => id !== match.ghostId && hits.length >= config.guidePoints / 4)
        if (match.accuracy > 0 && !spansGuides && length(match.guide) >= config.minAdaptLength) adapt(match.guide, match.user)
        recent.push(match.accuracy)
        if (recent.length > config.autoWindow) recent.shift()
      } else {
        lastAccuracy = onTheGuides ? closeness.accuracy : null // matched no guide: no score, no penalty
      }

      // Never a dead end: after stepPatience strokes near the same step's guides without finishing it, the
      // step counts as drawn and the lesson moves on. "Near" is generous on purpose: a stroke that matched a
      // guide, touched one, or stayed within scoring distance of them (e.g. one long stroke over several steps'
      // lines, or a guide shape the matcher can't follow) all count. Only strokes far from every guide don't.
      const attempted = match !== null || closeness.byGuide.size > 0 || closeness.accuracy > 0
      if (attempted && currentIndex() === stepAtStart && stepAtStart < lesson.length) {
        if (triesStep !== stepAtStart) {
          triesStep = stepAtStart
          triesOnStep = 0
        }
        triesOnStep++
        if (triesOnStep >= config.stepPatience) lesson[stepAtStart].strokes.forEach((s) => done.add(s.id))
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
