// Lines a whole solo drawing up with the target before measuring it, so drawing the fox smaller or off to one
// side is not counted as a mistake: only the proportions inside the drawing are.
import type { Pack, Point } from '../types'
import { config } from './config'
import { bbox, boxCenter, diagonal, procrustes, resample, type Transform } from './geometry'

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

// Nearest point of `cloud` to p (brute force: a few hundred points, so it's fast enough).
function nearest(p: Point, cloud: Point[]): Point {
  let best = cloud[0]
  let bestDistance = Infinity
  for (const q of cloud) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = q
    }
  }
  return best
}

// ICP (iterative closest point): start by matching the two bounding boxes, then repeat
// "pair every user point with its nearest target point, fit the best scale + shift + small rotation".
// Rotation is limited to 5 degrees, so a drawing that is really tilted still counts as tilted.
export function align(userStrokes: Point[][], target: Point[]): Alignment {
  const user = userStrokes.flatMap((s) => resample(s, config.alignPointsPerStroke))
  const userBox = bbox(user)
  const targetBox = bbox(target)
  const height = targetBox[3] || 1
  const [ucx, ucy] = boxCenter(userBox)
  const [tcx, tcy] = boxCenter(targetBox)
  const overallOffset = { dx: (ucx - tcx) / height, dy: (ucy - tcy) / height }

  // First guess: same size and center as the target.
  const startScale = diagonal(userBox) > 0 ? diagonal(targetBox) / diagonal(userBox) : 1
  let transform: Transform = { scale: startScale, rotation: 0, tx: tcx - startScale * ucx, ty: tcy - startScale * ucy }

  for (let i = 0; i < config.alignIterations; i++) {
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    const pairs = user.map((from) => {
      const moved: Point = [
        transform.scale * (cos * from[0] - sin * from[1]) + transform.tx,
        transform.scale * (sin * from[0] + cos * from[1]) + transform.ty,
      ]
      return { from, to: nearest(moved, target) }
    })
    const next = procrustes(pairs, config.alignMaxRotationDeg)
    const settled = Math.abs(next.scale - transform.scale) < 1e-4 && Math.hypot(next.tx - transform.tx, next.ty - transform.ty) < 0.05
    transform = next
    if (settled) break
  }
  return { transform, overallScale: 1 / transform.scale, overallOffset }
}
