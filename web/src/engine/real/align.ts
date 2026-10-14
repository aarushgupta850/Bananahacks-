// Lines a whole solo drawing up with the target before measuring it, so drawing the fox smaller or off to one
// side is not counted as a mistake: only the proportions inside the drawing are.
import type { Pack, Point } from '../types'
import { config } from './config'
import {
  applyTransform, bbox, boxCenter, clamp, diagonal, IDENTITY, invertTransform, PointGrid, procrustes, resample, type Transform,
} from './geometry'

export interface Alignment {
  transform: Transform                          // user space -> target space
  overallScale: number                          // 0.7 = the user drew 30% smaller than the target
  overallOffset: { dx: number; dy: number }     // where the user's drawing sat, as a fraction of the target height
}

// The points the target image is made of: every plan stroke except construction shapes (those are helpers
// the lesson draws, not lines in the picture). Packs that only have construction strokes use those.
export function targetPoints(pack: Pack): Point[] {
  const visible = pack.strokes.filter((s) => s.tier !== 'construction')
  const strokes = visible.length > 0 ? visible : pack.strokes
  return strokes.flatMap((s) => resample(s.points, config.alignPointsPerStroke))
}

// ICP (iterative closest point) from a first guess: repeat "pair every user point with its nearest target
// point, fit the best scale + shift + small rotation". Rotation is limited to 5 degrees, so a drawing that is
// really tilted still counts as tilted, and scale to config.alignScaleRange, so the fit can't shrink the
// drawing onto one corner of the target. Returns the transform and how far the user points end up from the
// target on average (the fit's error). `rounds` caps the iterations (a quick look from many starts uses few).
function icp(user: Point[], target: PointGrid, start: Transform, rounds: number = config.alignIterations): { transform: Transform; error: number } {
  // Each user point, moved by t, paired with its nearest target point.
  const pairsFor = (t: Transform) => user.map((from) => {
    const moved = applyTransform(t, from)
    return { from, moved, to: target.nearest(moved) ?? moved }
  })
  let transform = start
  for (let i = 0; i < rounds; i++) {
    const next = procrustes(pairsFor(transform), config.alignMaxRotationDeg, config.alignScaleRange)
    const settled = Math.abs(next.scale - transform.scale) < 1e-4 && Math.hypot(next.tx - transform.tx, next.ty - transform.ty) < 0.05
    transform = next
    if (settled) break
  }
  const final = pairsFor(transform)
  const mean = final.reduce((sum, p) => sum + Math.hypot(p.moved[0] - p.to[0], p.moved[1] - p.to[1]), 0) / Math.max(final.length, 1)
  // The error in the user's own units (divided by the scale): otherwise shrinking a drawing would look like a
  // better fit just because every distance shrinks with it.
  return { transform, error: mean / transform.scale }
}

// Two first guesses, because ICP only finds the nearest good fit to where it starts:
// - as drawn: the user draws on the same 768 x 768 canvas as the target, so a drawing usually already sits
//   about right. This is the guess that keeps a partly finished drawing (no tail yet) where it was drawn,
//   instead of stretching it over the whole target.
// - stretched: the user's bounding box moved and scaled onto the target's, for a drawing made much smaller
//   or off to one side.
// ICP runs from both and the better fit wins. As drawn wins near-ties, since it's what the user actually did.
export function align(userStrokes: Point[][], target: Point[]): Alignment {
  const user = userStrokes.flatMap((s) => resample(s, config.alignPointsPerStroke))
  const userBox = bbox(user)
  const targetBox = bbox(target)
  const [ucx, ucy] = boxCenter(userBox)
  const [tcx, tcy] = boxCenter(targetBox)
  const grid = new PointGrid(target)

  const startScale = diagonal(userBox) > 0 ? diagonal(targetBox) / diagonal(userBox) : 1
  const stretched: Transform = { scale: startScale, rotation: 0, tx: tcx - startScale * ucx, ty: tcy - startScale * ucy }
  const asDrawn = icp(user, grid, { ...IDENTITY })
  const fromStretched = icp(user, grid, stretched)
  const { transform } = fromStretched.error < config.alignPreferAsDrawn * asDrawn.error ? fromStretched : asDrawn
  return describe(transform, targetBox)
}

// An alignment from its transform: how big the user drew, and where (the target's center, taken back into the
// user's drawing).
function describe(transform: Transform, targetBox: [number, number, number, number]): Alignment {
  const [tcx, tcy] = boxCenter(targetBox)
  const height = targetBox[3] || 1
  const [ux, uy] = applyTransform(invertTransform(transform), [tcx, tcy])
  const overallOffset = { dx: (ux - tcx) / height, dy: (uy - tcy) / height }
  return { transform, overallScale: 1 / transform.scale, overallOffset }
}

// Other ways the drawing might line up, for analyze() to try besides align()'s. ICP only finds the nearest good
// fit to where it starts, and a rough copy drawn 100-200 px away from the target, or smaller, has wrong "good
// fits" close by (its head on the target's body), so align() can keep a drawing's shift and score it near 0.
// Here ICP also starts from a grid of shifts (at the drawn size and at the box-stretched size) around "centers
// lined up". A quick look from every start on a thinned copy of the drawing, ranked by the distance both ways
// (user lines to the target, and target lines to the user's), then the best few refined in full.
export function alignCandidates(userStrokes: Point[][], target: Point[]): Alignment[] {
  const user = userStrokes.flatMap((s) => resample(s, config.alignPointsPerStroke))
  const userBox = bbox(user)
  const targetBox = bbox(target)
  const [ucx, ucy] = boxCenter(userBox)
  const [tcx, tcy] = boxCenter(targetBox)
  const grid = new PointGrid(target)
  const stretch = diagonal(userBox) > 0 ? diagonal(targetBox) / diagonal(userBox) : 1
  const scales = [...new Set([1, clamp(stretch, config.alignScaleRange[0], config.alignScaleRange[1])])]
  const step = config.alignGridStep * diagonal(targetBox)
  const n = config.alignGridSteps
  const starts: Transform[] = []
  for (const k of scales) {
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) starts.push({ scale: k, rotation: 0, tx: tcx - k * ucx + i * step, ty: tcy - k * ucy + j * step })
    }
  }
  const meanTo = (points: Point[], to: PointGrid) =>
    points.reduce((sum, p) => { const q = to.nearest(p) ?? p; return sum + Math.hypot(p[0] - q[0], p[1] - q[1]) }, 0) / Math.max(points.length, 1)
  const thin = user.filter((_, i) => i % config.alignQuickThin === 0)
  const thinTarget = target.filter((_, i) => i % config.alignQuickThin === 0)
  const both = (t: Transform) => {
    const moved = thin.map((p) => applyTransform(t, p))
    return (meanTo(moved, grid) + meanTo(thinTarget, new PointGrid(moved))) / 2
  }
  return starts
    .map((start) => icp(thin, grid, start, config.alignQuickRounds).transform)
    .map((t) => ({ t, e: both(t) }))
    .sort((a, b) => a.e - b.e)
    .slice(0, config.alignRefine)
    .map(({ t }) => describe(icp(user, grid, t).transform, targetBox))
}
