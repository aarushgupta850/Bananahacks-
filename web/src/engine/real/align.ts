// Lines a whole solo drawing up with the target before measuring it, so drawing the fox smaller or off to one
// side is not counted as a mistake: only the proportions inside the drawing are.
import type { Pack, Point } from '../types'
import { config } from './config'
import {
  applyTransform, bbox, boxCenter, diagonal, IDENTITY, invertTransform, PointGrid, procrustes, resample, type Transform,
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
// target on average (the fit's error).
function icp(user: Point[], target: PointGrid, start: Transform): { transform: Transform; error: number } {
  // Each user point, moved by t, paired with its nearest target point.
  const pairsFor = (t: Transform) => user.map((from) => {
    const moved = applyTransform(t, from)
    return { from, moved, to: target.nearest(moved) ?? moved }
  })
  let transform = start
  for (let i = 0; i < config.alignIterations; i++) {
    const next = procrustes(pairsFor(transform), config.alignMaxRotationDeg, config.alignScaleRange)
    const settled = Math.abs(next.scale - transform.scale) < 1e-4 && Math.hypot(next.tx - transform.tx, next.ty - transform.ty) < 0.05
    transform = next
    if (settled) break
  }
  const final = pairsFor(transform)
  const error = final.reduce((sum, p) => sum + Math.hypot(p.moved[0] - p.to[0], p.moved[1] - p.to[1]), 0) / Math.max(final.length, 1)
  return { transform, error }
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

  // Where the user drew, read from the fit: the target's center, taken back into the user's drawing.
  const height = targetBox[3] || 1
  const [ux, uy] = applyTransform(invertTransform(transform), [tcx, tcy])
  const overallOffset = { dx: (ux - tcx) / height, dy: (uy - tcy) / height }
  return { transform, overallScale: 1 / transform.scale, overallOffset }
}
