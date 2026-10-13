// The eraser: removes only the parts of lines within `radius` of where it passes, so a line erased in the middle
// becomes two lines, and a line it only touches keeps the rest. Coordinates are in 768 target space.
import type { TimedPoint, UserStroke } from '../engine/types'

export const ERASER_RADIUS = 14 // target-space px: about the width of a fingertip on a tablet

// A stroke's points with extra points added along long gaps, so the eraser can cut in the middle of a straight run.
function densify(points: TimedPoint[], step: number): TimedPoint[] {
  const out: TimedPoint[] = []
  points.forEach((p, i) => {
    if (i > 0) {
      const q = points[i - 1]
      const gaps = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / step)
      for (let k = 1; k <= gaps; k++) {
        const t = k / (gaps + 1)
        out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t, q[2] + (p[2] - q[2]) * t, Math.round(q[3] + (p[3] - q[3]) * t)])
      }
    }
    out.push(p)
  })
  return out
}

// What is left of `strokes` after erasing along the segment from `from` to `to` (one eraser drag step). Each result
// says which stroke it came from (so the canvas keeps its pen size). Strokes the eraser misses are returned as the
// same objects, so nothing about them changes.
export function eraseAlong(
  strokes: UserStroke[], from: [number, number], to: [number, number], radius = ERASER_RADIUS,
): { stroke: UserStroke; source: number }[] {
  const r2 = radius * radius
  // Distance² from a point to the eraser's path this step (a short segment).
  const dx = to[0] - from[0], dy = to[1] - from[1], len2 = dx * dx + dy * dy
  const hit = ([x, y]: TimedPoint) => {
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / len2))
    const cx = from[0] + dx * t, cy = from[1] + dy * t
    return (x - cx) ** 2 + (y - cy) ** 2 <= r2
  }
  const out: { stroke: UserStroke; source: number }[] = []
  strokes.forEach((stroke, source) => {
    if (!stroke.points.some(hit) && !densify(stroke.points, radius / 2).some(hit)) {
      out.push({ stroke, source })
      return
    }
    // Keep each run of points the eraser didn't touch; runs of one point are too short to be a line.
    let run: TimedPoint[] = []
    const flush = () => {
      if (run.length >= 2) {
        const t0 = run[0][3]
        out.push({ stroke: { points: run.map(([x, y, p, t]): TimedPoint => [x, y, p, t - t0]) }, source })
      }
      run = []
    }
    for (const p of densify(stroke.points, radius / 2)) {
      if (hit(p)) flush()
      else run.push(p)
    }
    flush()
  })
  return out
}
