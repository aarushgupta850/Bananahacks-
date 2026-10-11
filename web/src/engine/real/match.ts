// Matches one user stroke to the guide (ghost) it was meant to trace, scores how close it came, and says which
// stretch of the guide it covered. A long guide can be drawn in several strokes, and a closed guide (a
// construction ellipse) can be started anywhere on it and drawn either way round.
import type { Point } from '../types'
import { config } from './config'
import { clamp, discreteFrechet, isClosed, length, meanNearest, partialFrechet, resample } from './geometry'

export interface MatchCandidate {
  id: string       // the plan stroke's id
  points: Point[]  // the guide as currently shown (already adapted to the user)
}

export interface Match {
  ghostId: string
  accuracy: number     // 0-1, for the stretch of the guide the stroke traced
  user: Point[]        // the user stroke, resampled
  guide: Point[]       // that stretch of the guide, resampled to pair point by point with `user`
  covered: number[]    // indices into the guide resampled to config.guidePoints that the stroke covered
}

// The cyclic shift and direction of a closed guide that best line it up with a closed stroke, comparing shapes
// only (both are centered and scaled to the same size first). A loop drawn bigger, smaller or off to one side
// still pairs each point with the matching point of the guide, which is what the guides' adaptation needs.
function bestLoopStart(user: Point[], loop: Point[]): Point[] {
  const normalize = (points: Point[]) => {
    const [cx, cy] = points.reduce(([x, y], p) => [x + p[0] / points.length, y + p[1] / points.length], [0, 0])
    const spread = Math.sqrt(points.reduce((sum, p) => sum + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / points.length) || 1
    return points.map((p): Point => [(p[0] - cx) / spread, (p[1] - cy) / spread])
  }
  const n = user.length
  const ring = loop.slice(0, -1) // the loop's last point repeats its first
  const u = normalize(user)
  let best = { cost: Infinity, points: loop }
  for (const reversed of [false, true]) {
    const base = reversed ? [...ring].reverse() : ring
    for (let shift = 0; shift < base.length; shift++) {
      const candidate = resample([...base.slice(shift), ...base.slice(0, shift), base[shift]], n)
      const c = normalize(candidate)
      let cost = 0
      for (let i = 0; i < n; i++) cost += (u[i][0] - c[i][0]) ** 2 + (u[i][1] - c[i][1]) ** 2
      if (cost < best.cost) best = { cost, points: candidate }
    }
  }
  return best.points
}

// Where one stroke fits best along one guide: the stretch it traced, in which direction, and how closely.
function fitAlong(user: Point[], userPoints: Point[], guidePoints: Point[]): { distance: number; stretch: Point[]; covered: number[] } {
  const n = config.guidePoints
  const guide = resample(guidePoints, n)
  const closed = isClosed(guidePoints)
  const all = Array.from({ length: closed ? n - 1 : n }, (_, i) => i)

  // A whole loop drawn round a closed guide (a construction ellipse): it may start anywhere and go either way.
  if (closed && isClosed(userPoints)) {
    const stretch = bestLoopStart(user, guide)
    const fit = partialFrechet(user, [...guide, ...guide.slice(1)]) // also allow the best free start, for accuracy
    const reversedFit = partialFrechet(user, [...guide, ...guide.slice(1)].reverse())
    const distance = Math.min(discreteFrechet(user, stretch), fit.distance, reversedFit.distance)
    return { distance, stretch, covered: all }
  }

  // Otherwise the stroke may trace any stretch of the guide. A closed guide is walked twice round, so a
  // stretch can run past the guide's own start point.
  const path = closed ? [...guide, ...guide.slice(1)] : guide
  let best = { distance: Infinity, from: 0, to: 0, reversed: false }
  for (const reversed of [false, true]) {
    const fit = partialFrechet(user, reversed ? [...path].reverse() : path)
    if (fit.distance < best.distance) best = { ...fit, reversed }
  }
  // Back to indices along `path` as it runs forwards.
  const last = path.length - 1
  let [from, to] = best.reversed ? [last - best.to, last - best.from] : [best.from, best.to]
  // A stretch that nearly reaches an end of an open guide is taken to reach it: a stroke drawn a little bigger
  // than its guide overshoots the ends, and pairing it with the whole guide keeps the adaptation right.
  const near = Math.round(0.1 * (n - 1))
  if (!closed && from <= near) from = 0
  if (!closed && to >= n - 1 - near) to = n - 1
  const stretch = path.slice(from, to + 1)
  if (best.reversed) stretch.reverse()
  // The search above compares the stroke with the guide's fixed sample points, which costs a little accuracy
  // even for a perfect trace. Comparing it again with the stretch resampled like the stroke removes that.
  const refined = discreteFrechet(user, resample(stretch, user.length))
  // Which of the guide's own points the stretch went past (a closed guide's index wraps around).
  const covered = new Set<number>()
  for (let i = from; i <= to; i++) covered.add(closed ? i % (n - 1) : i)
  return { distance: Math.min(best.distance, refined), stretch, covered: [...covered] }
}

// Tries every candidate guide near the stroke and keeps the closest fit. Returns null when the stroke is near
// no guide (e.g. a doodle off to the side): that costs the user nothing.
// accuracy = 1 - frechet / (accuracyScale * drawing diagonal), clamped to 0-1.
export function matchStroke(userPoints: Point[], candidates: MatchCandidate[], drawingDiagonal: number): Match | null {
  if (userPoints.length < 2 || candidates.length === 0 || drawingDiagonal <= 0) return null
  const user = resample(userPoints, config.resamplePoints)

  // One-way distance (stroke to guide), so a stroke that traces only part of a long guide still counts as near
  // it. Only guides about as near as the nearest one get the slower stretch-by-stretch fit below.
  const near = candidates
    .filter((c) => c.points.length > 0)
    .map((c) => ({ c, mean: meanNearest(user, resample(c.points, config.guidePoints)) }))
    .filter((x) => x.mean <= config.matchMaxChamfer * drawingDiagonal)
  const nearest = Math.min(...near.map((x) => x.mean))
  let best: (Match & { distance: number }) | null = null
  for (const { c: candidate } of near.filter((x) => x.mean <= 2 * nearest + 0.02 * drawingDiagonal)) {
    const fit = fitAlong(user, userPoints, candidate.points)
    if (best && fit.distance >= best.distance) continue
    best = {
      ghostId: candidate.id,
      accuracy: clamp(1 - fit.distance / (config.accuracyScale * drawingDiagonal), 0, 1),
      user,
      guide: resample(fit.stretch, config.resamplePoints),
      covered: fit.covered,
      distance: fit.distance,
    }
  }
  if (!best) return null
  const { distance: _distance, ...match } = best
  return match
}

// The share of a guide's points (resampled to config.guidePoints) that strokes have covered so far.
export function coverageShare(covered: Set<number>, guidePoints: Point[]): number {
  const n = config.guidePoints
  // A closed guide's last point is its first point again, so it has one point fewer to cover.
  const total = isClosed(guidePoints) ? n - 1 : n
  return Math.min(covered.size, total) / total
}

// Strokes shorter than this (in target-space pixels) are taps, not lines.
export function isTap(points: Point[]): boolean {
  return length(points) < config.minStrokeLength
}
