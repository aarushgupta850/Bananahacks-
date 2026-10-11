// Pure geometry helpers for the real engine. Points are [x, y] in 768 x 768 target space.
import type { Box, Point } from '../types'

export interface Transform {
  scale: number
  rotation: number // radians
  tx: number
  ty: number
}

export const IDENTITY: Transform = { scale: 1, rotation: 0, tx: 0, ty: 0 }

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
export const degToRad = (deg: number) => (deg * Math.PI) / 180

// Total length of a polyline.
export function length(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
  return total
}

// n points spread evenly along the line by distance travelled (arc length), so two strokes drawn at different
// speeds or with different point counts can be compared point by point.
export function resample(points: Point[], n = 64): Point[] {
  if (points.length === 0) return []
  if (points.length === 1 || n < 2) return Array.from({ length: n }, () => [points[0][0], points[0][1]] as Point)
  const total = length(points)
  if (total === 0) return Array.from({ length: n }, () => [points[0][0], points[0][1]] as Point)
  const step = total / (n - 1)
  const out: Point[] = [[points[0][0], points[0][1]]]
  let carried = 0 // distance covered since the last output point
  for (let i = 1; i < points.length && out.length < n; i++) {
    let [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    let segment = Math.hypot(bx - ax, by - ay)
    while (carried + segment >= step && out.length < n) {
      const t = (step - carried) / segment
      ax += (bx - ax) * t
      ay += (by - ay) * t
      out.push([ax, ay])
      segment = Math.hypot(bx - ax, by - ay)
      carried = 0
    }
    carried += segment
  }
  // Rounding can leave the last point out; the line always ends where it ends.
  while (out.length < n) out.push([points[points.length - 1][0], points[points.length - 1][1]])
  return out
}

export function centroid(points: Point[]): Point {
  if (points.length === 0) return [0, 0]
  let x = 0
  let y = 0
  for (const p of points) {
    x += p[0]
    y += p[1]
  }
  return [x / points.length, y / points.length]
}

// The smallest axis-aligned box around the points, as [x, y, w, h].
export function bbox(points: Point[]): Box {
  if (points.length === 0) return [0, 0, 0, 0]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return [minX, minY, maxX - minX, maxY - minY]
}

export const diagonal = (box: Box) => Math.hypot(box[2], box[3])
export const boxCenter = (box: Box): Point => [box[0] + box[2] / 2, box[1] + box[3] / 2]

// Discrete Frechet distance: the shortest "leash" that lets a person walk along line a while a dog walks along
// line b, both only moving forward. Unlike a plain average distance it notices when the order is wrong,
// e.g. a stroke that doubles back. Classic dynamic programming over every pair of points.
export function discreteFrechet(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  const m = b.length
  let previous = new Float64Array(m)
  let current = new Float64Array(m)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < m; j++) {
      const d = dist(a[i], b[j])
      if (i === 0 && j === 0) current[j] = d
      else if (i === 0) current[j] = Math.max(current[j - 1], d)
      else if (j === 0) current[j] = Math.max(previous[0], d)
      else current[j] = Math.max(Math.min(previous[j], previous[j - 1], current[j - 1]), d)
    }
    ;[previous, current] = [current, previous]
  }
  return previous[m - 1]
}

// Frechet distance ignoring which end the user started from: tries b forwards and backwards, keeps the better.
// `reversed` tells the caller which direction matched, so point i of a pairs with point i of the chosen b.
export function frechetEitherWay(a: Point[], b: Point[]): { distance: number; reversed: boolean } {
  const forward = discreteFrechet(a, b)
  const backward = discreteFrechet(a, [...b].reverse())
  return backward < forward ? { distance: backward, reversed: true } : { distance: forward, reversed: false }
}

// Average distance from each point of a to the nearest point of b.
export function meanNearest(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  let total = 0
  for (const p of a) {
    let best = Infinity
    for (const q of b) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
      if (d < best) best = d
    }
    total += Math.sqrt(best)
  }
  return total / a.length
}

// Symmetric Chamfer distance: how far a's points are from b, and b's from a, averaged.
// Order-free, so it doesn't care which way either line was drawn: a fast first filter before Frechet.
export function symmetricChamfer(a: Point[], b: Point[]): number {
  return (meanNearest(a, b) + meanNearest(b, a)) / 2
}

// Procrustes: the scale, rotation and shift that best move the `from` points onto the `to` points
// (least squares). The rotation is clamped to +-maxRotationDeg so a fit can never spin the drawing around,
// and the scale to `scaleRange` (by default only kept above 0.05, so a fit can never collapse to a point).
export function procrustes(
  pairs: { from: Point; to: Point }[], maxRotationDeg: number, scaleRange: [number, number] = [0.05, Infinity],
): Transform {
  if (pairs.length === 0) return { ...IDENTITY }
  const cf = centroid(pairs.map((p) => p.from))
  const ct = centroid(pairs.map((p) => p.to))
  // Centered sums give the best rotation angle directly: atan2(sum of cross products, sum of dot products).
  let dot = 0
  let cross = 0
  let norm = 0
  for (const { from, to } of pairs) {
    const ux = from[0] - cf[0]
    const uy = from[1] - cf[1]
    const vx = to[0] - ct[0]
    const vy = to[1] - ct[1]
    dot += ux * vx + uy * vy
    cross += ux * vy - uy * vx
    norm += ux * ux + uy * uy
  }
  const limit = degToRad(maxRotationDeg)
  const rotation = clamp(Math.atan2(cross, dot), -limit, limit)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  // With the rotation fixed, the best scale is the projection of the rotated `from` points onto the `to` points.
  let projected = 0
  for (const { from, to } of pairs) {
    const ux = from[0] - cf[0]
    const uy = from[1] - cf[1]
    projected += (cos * ux - sin * uy) * (to[0] - ct[0]) + (sin * ux + cos * uy) * (to[1] - ct[1])
  }
  const scale = norm > 0 ? clamp(projected / norm, scaleRange[0], scaleRange[1]) : 1
  // The shift moves the transformed `from` centroid onto the `to` centroid.
  const tx = ct[0] - scale * (cos * cf[0] - sin * cf[1])
  const ty = ct[1] - scale * (sin * cf[0] + cos * cf[1])
  return { scale, rotation, tx, ty }
}

export function applyTransform(t: Transform, p: Point): Point {
  const cos = Math.cos(t.rotation)
  const sin = Math.sin(t.rotation)
  return [t.scale * (cos * p[0] - sin * p[1]) + t.tx, t.scale * (sin * p[0] + cos * p[1]) + t.ty]
}

export const applyToAll = (t: Transform, points: Point[]) => points.map((p) => applyTransform(t, p))

// A transform t of the way from a to b (t = 0 gives a, t = 1 gives b). Used to move the guides gradually.
export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  const mix = (x: number, y: number) => x + (y - x) * t
  return { scale: mix(a.scale, b.scale), rotation: mix(a.rotation, b.rotation), tx: mix(a.tx, b.tx), ty: mix(a.ty, b.ty) }
}

// The inverse transform (undoes t). Used to measure the user's drawing in the target's frame.
export function invertTransform(t: Transform): Transform {
  const scale = 1 / t.scale
  const rotation = -t.rotation
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { scale, rotation, tx: -scale * (cos * t.tx - sin * t.ty), ty: -scale * (sin * t.tx + cos * t.ty) }
}

// A line whose two ends meet (a construction ellipse, a closed outline): it can be traced from any point.
export function isClosed(points: Point[]): boolean {
  if (points.length < 3) return false
  return dist(points[0], points[points.length - 1]) <= Math.max(10, 0.05 * length(points))
}

// Discrete Frechet distance from ALL of line a to the best-matching STRETCH of line b: the walk along a goes
// from its start to its end, but the walk along b may start and stop anywhere. `from`..`to` are the indices
// of b where that stretch starts and ends. This lets a stroke that traces only part of a long guide still
// score well, and says which part of the guide it covered.
export function partialFrechet(a: Point[], b: Point[]): { distance: number; from: number; to: number } {
  if (a.length === 0 || b.length === 0) return { distance: Infinity, from: 0, to: 0 }
  const m = b.length
  let previous = new Float64Array(m)
  let current = new Float64Array(m)
  let previousStart = new Int32Array(m) // where on b the best walk ending at (i, j) started
  let currentStart = new Int32Array(m)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < m; j++) {
      const d = dist(a[i], b[j])
      if (i === 0) {
        // The walk may start anywhere on b, so (0, j) never needs to come from (0, j - 1).
        current[j] = d
        currentStart[j] = j
        continue
      }
      // Best of the three ways into (i, j): from (i-1, j), (i-1, j-1) or (i, j-1).
      let best = previous[j]
      let start = previousStart[j]
      if (j > 0 && previous[j - 1] < best) {
        best = previous[j - 1]
        start = previousStart[j - 1]
      }
      if (j > 0 && current[j - 1] < best) {
        best = current[j - 1]
        start = currentStart[j - 1]
      }
      current[j] = Math.max(best, d)
      currentStart[j] = start
    }
    ;[previous, current] = [current, previous]
    ;[previousStart, currentStart] = [currentStart, previousStart]
  }
  // The walk may stop anywhere on b too: take the best end.
  let to = 0
  for (let j = 1; j < m; j++) if (previous[j] < previous[to]) to = j
  return { distance: previous[to], from: previousStart[to], to }
}

// Fast nearest-point lookups in a fixed cloud of points. The cloud is sorted into square cells, and a lookup
// searches outward ring by ring from the query's cell, stopping once no unsearched cell can be closer.
// Alignment makes thousands of lookups per drawing, which is far too slow when each checks every point.
export class PointGrid {
  private readonly cells = new Map<number, Point[]>()
  private readonly minX: number
  private readonly minY: number
  private readonly cols: number
  private readonly rows: number
  private readonly cellSize: number

  constructor(points: Point[], cellSize = 16) {
    this.cellSize = cellSize
    const [x, y, w, h] = bbox(points)
    this.minX = x
    this.minY = y
    this.cols = Math.floor(w / cellSize) + 1
    this.rows = Math.floor(h / cellSize) + 1
    for (const p of points) {
      const key = this.cellOf(p[0], this.minX, this.cols) + this.cellOf(p[1], this.minY, this.rows) * this.cols
      const cell = this.cells.get(key)
      if (cell) cell.push(p)
      else this.cells.set(key, [p])
    }
  }

  private cellOf(value: number, min: number, count: number): number {
    return clamp(Math.floor((value - min) / this.cellSize), 0, count - 1)
  }

  // The closest point of the cloud to p (null for an empty cloud).
  nearest(p: Point): Point | null {
    if (this.cells.size === 0) return null
    // The query's cell, which may lie outside the grid (e.g. a stroke drawn off to the side).
    const qx = Math.floor((p[0] - this.minX) / this.cellSize)
    const qy = Math.floor((p[1] - this.minY) / this.cellSize)
    const maxRing = Math.max(Math.abs(qx), Math.abs(qx - this.cols), Math.abs(qy), Math.abs(qy - this.rows)) + 1
    let best: Point | null = null
    let bestDistance = Infinity
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let cy = qy - ring; cy <= qy + ring; cy++) {
        if (cy < 0 || cy >= this.rows) continue
        // Only the cells on the ring's border are new: full rows at the top and bottom, two cells otherwise.
        const step = cy === qy - ring || cy === qy + ring ? 1 : 2 * ring
        for (let cx = qx - ring; cx <= qx + ring; cx += Math.max(step, 1)) {
          if (cx < 0 || cx >= this.cols) continue
          for (const q of this.cells.get(cx + cy * this.cols) ?? []) {
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
            if (d < bestDistance) {
              bestDistance = d
              best = q
            }
          }
        }
      }
      // Every cell further out is at least `ring` whole cells away from the query's cell.
      if (best && bestDistance <= (ring * this.cellSize) ** 2) break
    }
    return best
  }
}
