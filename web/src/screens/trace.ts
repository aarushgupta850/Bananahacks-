// The faint "trace" under the guides: the real lines of the original drawing, revealed part by part as the
// lesson goes on (never all at once), so the user always sees what the shape really looks like, not only the
// big construction circles.
import type { Ghost, PlanStroke, Point, Step } from '../engine/types'

// x' = a*x - b*y + tx, y' = b*x + a*y + ty: a move, turn and resize (a = scale*cos, b = scale*sin).
export interface Similarity { a: number; b: number; tx: number; ty: number }
export const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 }

// The guides move to follow where the user draws. The teacher shows each guide as its plan stroke moved by
// one move/turn/resize, so comparing a shown guide with its plan stroke recovers that movement (a least-squares
// fit, exact here). The trace then moves the same way and stays lined up with the guides.
export function fitSimilarity(from: Point[], to: Point[]): Similarity | null {
  const n = Math.min(from.length, to.length)
  if (n < 2) return null
  const mean = (pts: Point[]) => pts.slice(0, n).reduce(([x, y], p) => [x + p[0] / n, y + p[1] / n], [0, 0])
  const [fx, fy] = mean(from)
  const [tx, ty] = mean(to)
  let dot = 0
  let cross = 0
  let spread = 0
  for (let i = 0; i < n; i++) {
    const px = from[i][0] - fx
    const py = from[i][1] - fy
    const qx = to[i][0] - tx
    const qy = to[i][1] - ty
    dot += px * qx + py * qy
    cross += px * qy - py * qx
    spread += px * px + py * py
  }
  if (spread < 1e-6) return null // a dot: no direction or size to compare
  const a = dot / spread
  const b = cross / spread
  return { a, b, tx: tx - (a * fx - b * fy), ty: ty - (b * fx + a * fy) }
}

// The movement shown by the guides (from the first full guide), or null when no full guide is shown.
export function guideMovement(ghosts: Ghost[], plan: Map<string, Point[]>): Similarity | null {
  for (const ghost of ghosts) {
    const original = plan.get(ghost.strokeId)
    if (ghost.kind === 'keypoints' || !original || original.length !== ghost.points.length) continue
    const fit = fitSimilarity(original, ghost.points)
    if (fit) return fit
  }
  return null
}

const dist = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1])
export const lineLength = (points: Point[]) => points.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(points[i - 1], p)), 0)

// The first `length` pixels of a line (the last bit cut part-way), so a trace can grow along its line.
function firstPart(points: Point[], length: number): Point[] {
  const out: Point[] = points.slice(0, 1)
  let left = length
  for (let i = 1; i < points.length && left > 0; i++) {
    const step = dist(points[i - 1], points[i])
    if (step <= left) out.push(points[i])
    else {
      const t = left / step
      out.push([points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t])
    }
    left -= step
  }
  return out
}

// The real lines (never construction shapes) in the order the lesson gets to them: a line comes in at the
// first step that draws it or draws something of its part. Lines no step reaches come last.
export function revealOrder(strokes: PlanStroke[], steps: Step[]): { stroke: PlanStroke; step: number }[] {
  const byId = new Map(strokes.map((s) => [s.id, s]))
  const firstStep = (s: PlanStroke) => {
    const i = steps.findIndex((step) => step.strokeIds.some((id) => id === s.id || (s.partId !== null && byId.get(id)?.partId === s.partId)))
    return i === -1 ? steps.length : i
  }
  return strokes
    .filter((s) => s.tier !== 'construction' && s.points.length > 1)
    .map((stroke, order) => ({ stroke, step: firstStep(stroke), order }))
    .sort((a, b) => a.step - b.step || a.order - b.order)
    .map(({ stroke, step }) => ({ stroke, step }))
}

// What of the real drawing to trace now. The trace grows with every stroke the user draws (`budget`, in pixels
// of line, comes from Teach), along the lines in lesson order, so the drawing is revealed bit by bit and never
// all at once. Steps already finished are always traced in full. Nothing ever disappears once shown.
export function traceReveal(strokes: PlanStroke[], steps: Step[], currentIndex: number, budget: number): { id: string; points: Point[] }[] {
  let left = budget
  const out: { id: string; points: Point[] }[] = []
  for (const { stroke, step } of revealOrder(strokes, steps)) {
    const length = lineLength(stroke.points)
    if (step < currentIndex) out.push({ id: stroke.id, points: stroke.points }) // a finished step's part: all of it
    else if (left >= length) out.push({ id: stroke.id, points: stroke.points })
    else if (left > 0) out.push({ id: stroke.id, points: firstPart(stroke.points, left) })
    left -= Math.min(length, Math.max(left, 0))
  }
  return out
}

// How much more line one user stroke reveals: as much as they drew, but at least 1/12 of the whole drawing,
// so every drawing is fully traced after about a dozen strokes at most.
export const REVEAL_STEPS = 12
export function revealFor(drawnLength: number, totalLength: number): number {
  return Math.max(drawnLength, totalLength / REVEAL_STEPS)
}

// The movement to apply to the trace now. Normally the movement of the guides on screen, so the trace and the
// guides always move together. When no full guide is shown (the lesson is done, or only key points are left)
// the trace keeps the movement it had: falling back to "no movement" made the finished drawing jump back to
// the reference's place, away from the user's lines, the moment the lesson ended. Tiny float differences
// between guides (well under a pixel) also keep the previous value, so the CSS transform doesn't change at all.
export function traceMovement(ghosts: Ghost[], plan: Map<string, Point[]>, previous: Similarity, done: boolean): Similarity {
  const now = done ? null : guideMovement(ghosts, plan)
  if (!now) return previous
  const same = Math.abs(now.a - previous.a) < 1e-4 && Math.abs(now.b - previous.b) < 1e-4 &&
    Math.abs(now.tx - previous.tx) < 0.05 && Math.abs(now.ty - previous.ty) < 0.05
  return same ? previous : now
}
