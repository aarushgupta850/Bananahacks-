// The eraser, as a pure function: rub out every part of the user's ink that lies under the eraser's path.
// It removes small parts of lines, not whole strokes: a stroke cut in the middle becomes two strokes.
// Everything is in 768 x 768 target space, like the strokes themselves.
import type { Point, TimedPoint, UserStroke } from '../engine/types'

// How big the eraser is: its radius in target space (about two bold pen widths).
export const ERASER_RADIUS = 14

// Strokes can have long straight segments with only two points. To cut through the middle of one we add
// points along it, one every RESAMPLE_STEP target pixels, but only on segments the eraser comes near.
const RESAMPLE_STEP = 3

// A box around some points, grown by `margin` on every side.
interface Box { minX: number; minY: number; maxX: number; maxY: number }

function boxAround(points: readonly (Point | TimedPoint)[], margin: number): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }
}

const inBox = (x: number, y: number, b: Box) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY

// Squared distance from point (px, py) to the segment a-b. Squared, so no square root in the hot loop.
function distanceSq(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  // How far along a-b the closest point is, from 0 (at a) to 1 (at b). A zero-length segment is just point a.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSq))
  const cx = a[0] + t * dx - px
  const cy = a[1] + t * dy - py
  return cx * cx + cy * cy
}

// A point part of the way (t from 0 to 1) from a to b. Pressure and time are blended too, so a cut piece
// keeps believable values at its new ends.
function lerp(a: TimedPoint, b: TimedPoint, t: number): TimedPoint {
  return [
    Math.round((a[0] + (b[0] - a[0]) * t) * 10) / 10, // one decimal, like toTargetPoint
    Math.round((a[1] + (b[1] - a[1]) * t) * 10) / 10,
    a[2] + (b[2] - a[2]) * t,
    Math.round(a[3] + (b[3] - a[3]) * t),
  ]
}

/**
 * Returns the strokes with every point within `radius` of `eraserPath` removed. Where points are removed the
 * stroke is split, and pieces left with fewer than 2 points are dropped. Strokes the eraser never touches come
 * back as the very same objects, so callers can tell nothing changed (and React need not redraw them).
 *
 * `onSplit` is told which new pieces came from which original stroke, so the canvas can carry over the pen
 * size it remembers for that stroke.
 */
export function eraseAlong(
  strokes: UserStroke[],
  eraserPath: Point[],
  radius: number,
  onSplit?: (original: UserStroke, pieces: UserStroke[]) => void,
): UserStroke[] {
  if (eraserPath.length === 0 || strokes.length === 0) return strokes
  const radiusSq = radius * radius
  // Quick rejection: a point or segment outside this box can't be within `radius` of the eraser.
  const reach = boxAround(eraserPath, radius)
  // The eraser's path as segments. A single point (a tap) becomes a zero-length segment.
  const segments: [Point, Point][] = eraserPath.length === 1
    ? [[eraserPath[0], eraserPath[0]]]
    : eraserPath.slice(1).map((p, i) => [eraserPath[i], p])

  const isErased = (x: number, y: number) => {
    if (!inBox(x, y, reach)) return false
    for (const [a, b] of segments) if (distanceSq(x, y, a, b) <= radiusSq) return true
    return false
  }

  let changed = false
  const result: UserStroke[] = []
  for (const stroke of strokes) {
    const pieces = eraseStroke(stroke, isErased, reach)
    if (pieces === null) {
      result.push(stroke) // untouched: keep the same object
      continue
    }
    changed = true
    onSplit?.(stroke, pieces)
    result.push(...pieces)
  }
  return changed ? result : strokes
}

// Cuts one stroke. Returns null when the eraser removed none of its points.
function eraseStroke(stroke: UserStroke, isErased: (x: number, y: number) => boolean, reach: Box): UserStroke[] | null {
  const points = stroke.points
  if (points.length === 0) return null
  const pieces: UserStroke[] = []
  let current: TimedPoint[] = []
  let removedAny = false

  // Adds the next point of the stroke: kept points grow the current piece, an erased point ends it.
  const visit = (p: TimedPoint) => {
    if (isErased(p[0], p[1])) {
      removedAny = true
      if (current.length >= 2) pieces.push({ points: current })
      current = []
    } else {
      current.push(p)
    }
  }

  visit(points[0])
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    // Only segments that come near the eraser get extra points in between (most of a stroke never does,
    // which keeps this fast for strokes with thousands of points).
    const near = Math.max(a[0], b[0]) >= reach.minX && Math.min(a[0], b[0]) <= reach.maxX
      && Math.max(a[1], b[1]) >= reach.minY && Math.min(a[1], b[1]) <= reach.maxY
    if (near) {
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / RESAMPLE_STEP)
      for (let k = 1; k < steps; k++) visit(lerp(a, b, k / steps))
    }
    visit(b)
  }
  if (!removedAny) return null
  if (current.length >= 2) pieces.push({ points: current })
  return pieces
}
