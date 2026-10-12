// The Teacher: runs one lesson. It checks every stroke against the current step's guides, moves the guides to
// follow where the user is actually drawing, and decides how much help to show (Guided, Hints, Check-in).
import type {
  Ghost, HelpLevel, Mode, ModeChange, Pack, PlanStroke, Point, Step, StrokeResult, Teacher, UserStroke,
} from '../types'
import { config } from './config'
import {
  applyToAll, bbox, diagonal, IDENTITY, invertTransform, isClosed, length, lerpTransform, PointGrid, procrustes,
  resample, type Transform,
} from './geometry'
import { accuracyFor, coverageShare, isTap, matchStroke, tolerance, type Match } from './match'

const isIdentity = (t: Transform) => t.scale === 1 && t.rotation === 0 && t.tx === 0 && t.ty === 0

// How spread out a line's points are: their root-mean-square distance from their middle (a size measure).
function spread(points: Point[]): number {
  const [cx, cy] = points.reduce(([x, y], p) => [x + p[0] / points.length, y + p[1] / points.length], [0, 0])
  return Math.sqrt(points.reduce((sum, p) => sum + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / Math.max(points.length, 1))
}

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
  const finishedAt = new Map<string, number>()  // plan stroke id -> the stroke count when strokes finished it
  let triesOnStep = 0                        // strokes in a row near the current step's guides that finished none of them
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
  // Sizes are compared by spread (how far the points lie from their middle, on average), which a small overshoot
  // at the ends hardly changes. Short guides (a toe, an eye) are skipped: a few pixels past each end of a 30 px
  // line looks 30% bigger, which used to warn about strokes that were fine.
  function sizeWarning(strokeId: string, user: Point[], guide: Point[]): string | undefined {
    const partId = plan.get(strokeId)?.partId
    if (!partId || diagonal(bbox(guide)) < config.warnMinGuide * baseDiagonal * transform.scale) return undefined
    const ratio = spread(user) / Math.max(spread(guide), 1e-6)
    const name = partLabel.get(partId) ?? 'part'
    const many = /[^s]s$/.test(name) // "legs", "ears": "the legs are", "keep them"
    const [is, it] = many ? ['are', 'them'] : ['is', 'it']
    if (ratio > 1 + config.warnSizeRatio) return `The ${name} ${is} getting large. Try keeping ${it} closer to the guide.`
    if (ratio < 1 - config.warnSizeRatio) return `The ${name} ${is} getting small. Try making ${it} a bit bigger.`
    return undefined
  }

  // A stroke that goes over a line finished earlier (drawing it again, or tidying it up) instead of the guides on
  // screen: its match against that finished line, or null. Only a stroke clearly on a finished line and clearly
  // off every shown guide counts, so a stroke meant for the current guide is never mistaken for one. Without
  // this, a careful redraw was judged against the current guide and showed "0% match".
  function redrawOfFinished(userPoints: Point[], current: Match | null, shownIds: Set<string>): Match | null {
    if (current && current.accuracy >= config.redrawMaxCurrent) return null
    const finished = pack.strokes
      .filter((s) => done.has(s.id) && !shownIds.has(s.id) && length(s.points) >= config.minStrokeLength)
      .map((s) => ({ id: s.id, points: adapted(s.points) }))
    const redraw = matchStroke(userPoints, finished, baseDiagonal * transform.scale)
    return redraw && redraw.accuracy >= config.redrawMinAccuracy ? redraw : null
  }

  // Which sample points of each shown guide a stroke passed close to (the same points match.ts uses, so the two
  // kinds of coverage add up). This credits a stroke that runs along two guides at once (a whole outline in one
  // go), one drawn backwards, or one in a different order. Also returns how close the stroke stayed to the guides.
  function coverByCloseness(userPoints: Point[], candidates: { id: string; points: Point[] }[]) {
    const nearEnough = config.coverDistance * baseDiagonal * transform.scale
    const user = resample(userPoints, 2 * config.guidePoints)
    const guides = candidates.map((c) => ({ id: c.id, closed: isClosed(c.points), points: resample(c.points, config.guidePoints) }))
    const guidePoints = guides.flatMap((g) => g.points)
    // Grids make "closest point" lookups fast (a few cells instead of every point), keeping addStroke quick.
    const cellSize = Math.max(nearEnough, 8)
    const userGrid = new PointGrid(user, cellSize)
    const guideGrid = new PointGrid(guidePoints, cellSize)
    const distanceTo = (p: Point, grid: PointGrid) => {
      const q = grid.nearest(p)
      return q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity
    }
    const byGuide = new Map<string, number[]>()
    for (const g of guides) {
      // A closed guide's last point is its first point again.
      const hits = g.points.flatMap((p, i) => (distanceTo(p, userGrid) <= nearEnough ? [g.closed && i === g.points.length - 1 ? 0 : i] : []))
      if (hits.length > 0) byGuide.set(g.id, hits)
    }
    // Share of the stroke that stayed on the guides (a stroke mostly off them earns no credit), and a score
    // from its average distance to them, on the same scale as match.ts's accuracy.
    const distances = user.map((p) => distanceTo(p, guideGrid))
    const onGuides = distances.filter((d) => d <= nearEnough).length / user.length
    const mean = guidePoints.length > 0 ? distances.reduce((sum, d) => sum + d, 0) / user.length : Infinity
    // Judged with the room the guides it ran along allow (see match.ts), so a stroke over two short guides is
    // held to the same standard as one over a single short guide.
    const along = guides.filter((g) => byGuide.has(g.id)).flatMap((g) => g.points)
    const accuracy = guidePoints.length > 0 ? accuracyFor(mean, tolerance(along.length > 0 ? along : guidePoints, baseDiagonal * transform.scale)) : 0
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
        // Also the guides finished by the last few strokes (no longer shown): the piece that completes a line
        // drawn in several strokes is judged against that line, not against whatever guide is left.
        const recent = [...finishedAt].filter(([, at]) => strokeCount - at <= config.finishWindow).map(([id]) => plan.get(id))
        const shownIds = new Set(shownStrokes().map((s) => s.id))
        const shown = [...shownStrokes(), ...recent.filter((s): s is PlanStroke => !!s && !shownIds.has(s.id))]
          .map((s) => ({ id: s.id, points: adapted(s.points) }))
        return {
          match: matchStroke(userPoints, shown, baseDiagonal * transform.scale),
          closeness: coverByCloseness(userPoints, shown),
          shownIds: new Set(shown.map((s) => s.id)),
        }
      }
      let { match, closeness, shownIds } = look()
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
          ;({ match, closeness, shownIds } = look())
        }
      }

      // Going over a line finished earlier: it is scored against that line, and credits or moves nothing (no
      // guide done, no adapting, no help-level change). It still counts as a try on the step below, so however
      // a stroke is read, the lesson can never stall.
      const redraw = closeness.onGuides < config.doneCoverage ? redrawOfFinished(userPoints, match, shownIds) : null

      const stepAtStart = currentIndex()
      const stepGuides = stepAtStart < lesson.length ? lesson[stepAtStart].strokes : []
      const finishedBefore = stepGuides.filter((s) => done.has(s.id)).length
      const credit = (id: string, indices: number[]) => {
        const traced = covered.get(id) ?? new Set<number>()
        indices.forEach((i) => traced.add(i))
        covered.set(id, traced)
        // The guide is drawn once most of it is covered, by one stroke or several (a long outline in pieces).
        if (!done.has(id) && coverageShare(traced, plan.get(id)?.points ?? []) >= config.doneCoverage) {
          done.add(id)
          finishedAt.set(id, strokeCount)
        }
      }

      // Every guide point the stroke passed close to counts, if most of the stroke stayed on the guides.
      const onTheGuides = closeness.onGuides >= config.doneCoverage
      if (onTheGuides) closeness.byGuide.forEach((indices, id) => credit(id, indices))

      let warning: string | undefined
      if (redraw) {
        lastAccuracy = redraw.accuracy
      } else if (match) {
        // A stroke that ran along several guides at once ("ran along" = passed close to at least a quarter of
        // another guide; brushing past its end doesn't count) matches neither guide on its own.
        const spansGuides = [...closeness.byGuide].some(([id, hits]) => id !== match.ghostId && hits.length >= config.guidePoints / 4)
        // Such a stroke, if it stayed on the guides, is scored by how close it stayed to them. Any other stroke is
        // scored against the guide it traced, and the score shown is that stroke's own (a careless last piece of a
        // line drawn in pieces shows as careless, not averaged away by the careful pieces before it).
        lastAccuracy = onTheGuides && spansGuides ? Math.max(match.accuracy, closeness.accuracy) : match.accuracy
        // A good stroke also covers the stretch of the guide it was matched to.
        if (match.accuracy >= config.doneThreshold) credit(match.ghostId, match.covered)
        warning = sizeWarning(match.ghostId, match.user, match.guide)
        // A stroke with zero accuracy is too far off its guide to say where the user is drawing, and a dot or
        // a short tick is too small to say how big the user is drawing. A stroke along several guides can't be
        // paired point by point with the one it matched, and pairing it anyway would pull the guides away from
        // the user, so it doesn't move them.
        if (match.accuracy > 0 && !spansGuides && length(match.guide) >= config.minAdaptLength) adapt(match.guide, match.user)
        recent.push(lastAccuracy) // Auto judges the same score the user sees
        if (recent.length > config.autoWindow) recent.shift()
      } else {
        lastAccuracy = onTheGuides ? closeness.accuracy : null // matched no guide: no score, no penalty
      }

      // Never a dead end: after stepPatience strokes in a row near the same step's guides that finish none of
      // them, the step counts as drawn and the lesson moves on. "Near" is generous on purpose: a stroke that
      // matched a guide, touched one, or stayed within scoring distance of them (e.g. one long stroke over
      // several steps' lines, or a guide shape the matcher can't follow) all count. Only strokes far from every
      // guide don't. A stroke that finishes one of the step's guides is progress, not a failed try: a step with
      // four guides drawn well used to be cut short after six strokes.
      const attempted = redraw !== null || match !== null || closeness.byGuide.size > 0 || closeness.accuracy > 0
      const progressed = stepGuides.filter((s) => done.has(s.id)).length > finishedBefore
      if (attempted && currentIndex() === stepAtStart && stepAtStart < lesson.length) {
        if (triesStep !== stepAtStart || progressed) {
          triesStep = stepAtStart
          triesOnStep = 0
        }
        if (!progressed) triesOnStep++
        if (triesOnStep >= config.stepPatience) {
          lesson[stepAtStart].strokes.filter((s) => !done.has(s.id)).forEach((s) => {
            done.add(s.id)
            finishedAt.set(s.id, strokeCount) // still matchable for a moment, like any guide just finished
          })
        }
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
