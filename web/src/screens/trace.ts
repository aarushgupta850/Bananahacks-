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

// Which real strokes to trace: the lines of every part the lesson has reached (finished steps and the current
// one), plus the lines of finished steps that belong to no part. Construction shapes are never traced (they
// are guides, not part of the drawing). Later parts stay hidden until the lesson gets to them.
export function traceStrokes(strokes: PlanStroke[], steps: Step[], currentIndex: number): PlanStroke[] {
  const byId = new Map(strokes.map((s) => [s.id, s]))
  const reached = steps.slice(0, currentIndex + 1).flatMap((step) => step.strokeIds)
  const parts = new Set(reached.map((id) => byId.get(id)?.partId).filter((p): p is string => !!p))
  const ids = new Set(reached)
  return strokes.filter((s) => s.tier !== 'construction' && (ids.has(s.id) || (s.partId !== null && parts.has(s.partId))))
}
