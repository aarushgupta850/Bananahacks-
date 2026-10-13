// Synthetic drawings of known quality for the accuracy harness (realAccuracy.test.ts). Each function turns a
// pack into the strokes a certain kind of learner would draw: a careful copy, a copy drawn smaller and off to
// one side, one part too big, a wobbly copy, scribbles, and so on. Everything is seeded, so every run draws
// exactly the same lines and the scores never flicker.
import type { Pack, Point, TimedPoint, UserStroke } from '../types'

// Seeded random numbers (mulberry32).
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const timed = (points: Point[]): UserStroke => ({ points: points.map(([x, y], j): TimedPoint => [x, y, 0.5, j * 16]) })
const toPoints = (s: UserStroke): Point[] => s.points.map(([x, y]): Point => [x, y])

// The visible plan lines of a pack (what the target picture is made of), as Point lists.
export const planLines = (pack: Pack): { points: Point[]; partId: string | null }[] => pack.strokes
  .filter((s) => s.tier !== 'construction')
  .map((s) => ({ points: s.points.map(([x, y]): Point => [x, y]), partId: s.partId }))

// More points along a line (a person's stroke has a sample every few px, a plan line only a few vertices).
function densify(points: Point[], step = 4): Point[] {
  if (points.length < 2) return points
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  return out
}

// Smooth noise along a stroke: a random offset that drifts slowly (a hand that wanders), not white noise.
// `amp` is the largest offset in px, `wavelength` the distance in px over which it changes direction.
function wander(points: Point[], amp: number, wavelength: number, r: () => number): Point[] {
  const phases = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3]
  let travelled = 0
  return points.map((p, i) => {
    if (i > 0) travelled += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1])
    const t = (travelled / wavelength) * 2 * Math.PI
    return [
      p[0] + (amp * (Math.sin(t + phases[0]) + 0.6 * Math.sin(2.3 * t + phases[1]))) / 1.6,
      p[1] + (amp * (Math.sin(t + phases[2]) + 0.6 * Math.sin(1.7 * t + phases[3]))) / 1.6,
    ]
  })
}

// Small white jitter (a steady hand on a trackpad still shakes a pixel or two).
const shake = (points: Point[], amp: number, r: () => number): Point[] =>
  points.map(([x, y]) => [x + (r() - 0.5) * 2 * amp, y + (r() - 0.5) * 2 * amp])

const center = (pack: Pack): Point => {
  const all = planLines(pack).flatMap((l) => l.points)
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

// (a) A careful copy: every plan line, densified, wandering at most `amp` px, with a tiny shake.
export function perfectCopy(pack: Pack, seed = 1, amp = 2): UserStroke[] {
  const r = rng(seed)
  return planLines(pack).map((l) => timed(shake(wander(densify(l.points), amp, 120, r), 0.6, r)))
}

// (b) The same drawing scaled about the drawing's center and shifted.
export function transformed(strokes: UserStroke[], pack: Pack, scale: number, dx: number, dy: number): UserStroke[] {
  const [cx, cy] = center(pack)
  return strokes.map((s) => timed(toPoints(s).map(([x, y]): Point => [cx + (x - cx) * scale + dx, cy + (y - cy) * scale + dy])))
}

// (c) One part changed: scaled about its own center, moved, or left out. The rest is a careful copy.
export function partEdited(pack: Pack, partId: string, edit: { scale?: number; dx?: number; dy?: number; drop?: boolean }, seed = 1): UserStroke[] {
  const r = rng(seed)
  const lines = planLines(pack)
  const own = lines.filter((l) => l.partId === partId).flatMap((l) => l.points)
  const xs = own.map((p) => p[0])
  const ys = own.map((p) => p[1])
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  const s = edit.scale ?? 1
  return lines
    .filter((l) => !(edit.drop && l.partId === partId))
    .map((l) => {
      const pts = l.partId === partId
        ? l.points.map(([x, y]): Point => [cx + (x - cx) * s + (edit.dx ?? 0), cy + (y - cy) * s + (edit.dy ?? 0)])
        : l.points
      return timed(shake(wander(densify(pts), 2, 120, r), 0.6, r))
    })
}

// (d) A sloppy copy: every line drawn, but wandering up to `amp` px off it with a shaky hand.
export function sloppyCopy(pack: Pack, seed = 2, amp = 14): UserStroke[] {
  const r = rng(seed)
  return planLines(pack).map((l) => timed(shake(wander(densify(l.points), amp, 70, r), 2.5, r)))
}

// (e1) Scribbles: tight back-and-forth loops all over the drawing area.
export function scribbles(pack: Pack, seed = 3): UserStroke[] {
  const r = rng(seed)
  const [cx, cy] = center(pack)
  return Array.from({ length: 10 }, () => {
    const x0 = cx + (r() - 0.5) * 400
    const y0 = cy + (r() - 0.5) * 400
    return timed(Array.from({ length: 60 }, (_, i): Point => [x0 + 40 * Math.sin(i * 0.9) + r() * 10, y0 + 30 * Math.cos(i * 0.7) + r() * 10]))
  })
}

// (e2) Random straight lines across the drawing area (no back-and-forth, so the scribble filter can't see them).
export function randomLines(pack: Pack, seed = 4, count = 14): UserStroke[] {
  const r = rng(seed)
  const [cx, cy] = center(pack)
  return Array.from({ length: count }, () => {
    const a: Point = [cx + (r() - 0.5) * 500, cy + (r() - 0.5) * 500]
    const b: Point = [cx + (r() - 0.5) * 500, cy + (r() - 0.5) * 500]
    return timed(densify([a, b], 6))
  })
}

// (e3) Random smooth curves (arcs) across the drawing area.
export function randomCurves(pack: Pack, seed = 5, count = 14): UserStroke[] {
  const r = rng(seed)
  const [cx, cy] = center(pack)
  return Array.from({ length: count }, () => {
    const x0 = cx + (r() - 0.5) * 400
    const y0 = cy + (r() - 0.5) * 400
    const rad = 30 + r() * 150
    const a0 = r() * 6.3
    const sweep = 0.8 + r() * 2.5
    return timed(Array.from({ length: 40 }, (_, i): Point => [x0 + rad * Math.cos(a0 + (i / 39) * sweep), y0 + rad * Math.sin(a0 + (i / 39) * sweep)]))
  })
}

// (f) One stroke: the first (usually the biggest outline) line of the plan.
export function oneStroke(pack: Pack): UserStroke[] {
  return perfectCopy(pack).slice(0, 1)
}

// (h) Part of the drawing: the first `share` of the plan lines in pack order.
export function partial(pack: Pack, share = 0.5, seed = 1): UserStroke[] {
  const all = perfectCopy(pack, seed)
  return all.slice(0, Math.max(1, Math.round(all.length * share)))
}

// (i1) The plan lines drawn backwards and in reverse order.
export function reversedOrder(pack: Pack, seed = 1): UserStroke[] {
  return perfectCopy(pack, seed).reverse().map((s) => timed(toPoints(s).reverse()))
}

// (i2) Every line drawn as many short pieces (a sketchy hand), each about `piece` px long, pieces slightly
// overlapping like real sketch dashes.
export function splitIntoPieces(pack: Pack, piece = 40, seed = 1): UserStroke[] {
  const out: UserStroke[] = []
  for (const s of perfectCopy(pack, seed)) {
    const pts = toPoints(s)
    let start = 0
    let run = 0
    for (let i = 1; i < pts.length; i++) {
      run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (run >= piece || i === pts.length - 1) {
        out.push(timed(pts.slice(Math.max(0, start - 1), i + 1)))
        start = i
        run = 0
      }
    }
  }
  return out
}

// (j) The drawing mirrored left to right about its own center.
export function mirrored(pack: Pack, seed = 1): UserStroke[] {
  const [cx] = center(pack)
  return perfectCopy(pack, seed).map((s) => timed(toPoints(s).map(([x, y]): Point => [2 * cx - x, y])))
}

// Every line drawn twice on top of itself, a few px apart (a hesitant "go over it again").
export function doubledLines(pack: Pack, seed = 6): UserStroke[] {
  const r = rng(seed)
  return planLines(pack).flatMap((l) => {
    const pts = densify(l.points)
    return [timed(shake(wander(pts, 2, 120, r), 0.6, r)), timed(shake(wander(pts, 3, 120, r), 0.6, r))]
  })
}

// A realistic sloppy copy: every line drawn, but each one a little off where it belongs (shifted by up to
// `shift` px, scaled by up to +-15%, turned by up to +-8 degrees about its own center), with a wobbly hand.
export function misplacedCopy(pack: Pack, seed = 7, shift = 18, amp = 6): UserStroke[] {
  const r = rng(seed)
  return planLines(pack).map((l) => {
    const pts = densify(l.points)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    const s = 1 + (r() - 0.5) * 0.3
    const a = ((r() - 0.5) * 16 * Math.PI) / 180
    const [dx, dy] = [(r() - 0.5) * 2 * shift, (r() - 0.5) * 2 * shift]
    const moved = pts.map(([x, y]): Point => {
      const [ux, uy] = [(x - cx) * s, (y - cy) * s]
      return [cx + ux * Math.cos(a) - uy * Math.sin(a) + dx, cy + ux * Math.sin(a) + uy * Math.cos(a) + dy]
    })
    return timed(shake(wander(moved, amp, 90, r), 1.5, r))
  })
}

// One part left out entirely, the rest drawn at `scale` about the drawing's center, shifted, with `jitter` px of
// shake on every point (a sketchy hand). This is the case seen in a walkthrough: a cat without its tail,
// drawn at 0.85x with 10 px jitter, scored 93.
export function withoutPart(pack: Pack, partId: string, scale = 0.85, jitter = 10, seed = 8): UserStroke[] {
  const r = rng(seed)
  const kept = planLines(pack).filter((l) => l.partId !== partId).map((l) => timed(shake(densify(l.points, 6), jitter, r)))
  return transformed(kept, pack, scale, -30, 25)
}

// The first `share` of the plan lines in pack order, drawn at `scale`, shifted, with `jitter` px of shake on
// every point. The walkthrough case: cat-medium at 2/3, 0.85x, 10 px, which lost the whole tail and scored 93.
export function sketchyPartial(pack: Pack, share = 2 / 3, scale = 0.85, jitter = 10, seed = 9): UserStroke[] {
  const r = rng(seed)
  const lines = planLines(pack)
  const kept = lines.slice(0, Math.max(1, Math.round(lines.length * share))).map((l) => timed(shake(densify(l.points, 6), jitter, r)))
  return transformed(kept, pack, scale, -30, 25)
}
