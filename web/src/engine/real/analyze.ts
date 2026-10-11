// Measures a solo drawing (the test or the retest) against the target, part by part.
// Every number the report shows starts here.
import type { Analysis, Box, Pack, PartMetric, Point, TimedPoint, UserStroke } from '../types'
import { align, targetPoints } from './align'
import { config } from './config'
import {
  applyTransform, bbox, boxCenter, clamp, diagonal, meanNearest, resample, symmetricChamfer,
} from './geometry'

const round2 = (n: number) => Math.round(n * 100) / 100

// The angle of a point cloud's long axis in degrees (principal component), and how elongated it is
// (long spread / short spread). A round cloud has no meaningful angle, which is why the ratio is returned too.
function principalAxis(points: Point[]): { angleDeg: number; elongation: number } {
  if (points.length < 2) return { angleDeg: 0, elongation: 1 }
  const [cx, cy] = points.reduce(([x, y], p) => [x + p[0] / points.length, y + p[1] / points.length], [0, 0])
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - cx) ** 2
    syy += (y - cy) ** 2
    sxy += (x - cx) * (y - cy)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const spread = Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2)
  const major = (sxx + syy + spread) / 2
  const minor = Math.max((sxx + syy - spread) / 2, 1e-6)
  return { angleDeg: (angle * 180) / Math.PI, elongation: Math.sqrt(major / minor) }
}

// Difference between two axis angles, wrapped to -90..90 (an axis at 170 degrees is the same as one at -10).
function angleDifference(a: number, b: number): number {
  let d = a - b
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  return d
}

// The plan points of each part: its visible strokes, else its construction shapes, else its box outline.
function partPointSets(pack: Pack): Map<string, Point[]> {
  const sets = new Map<string, Point[]>()
  for (const part of pack.parts) {
    const own = pack.strokes.filter((s) => s.partId === part.id)
    const visible = own.filter((s) => s.tier !== 'construction')
    const chosen = visible.length > 0 ? visible : own
    const [x, y, w, h] = part.box
    sets.set(part.id, chosen.length > 0
      ? chosen.flatMap((s) => resample(s.points, config.alignPointsPerStroke))
      : resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], config.alignPointsPerStroke))
  }
  return sets
}

// Smoothness from how much the line turns between samples. The median ignores a few real corners
// (a triangle ear has three), so only constant wobble counts as shaky.
function smoothness(stroke: Point[]): number {
  const p = resample(stroke, config.alignPointsPerStroke)
  const turns: number[] = []
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0])
    const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0])
    let turn = Math.abs(b - a)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    turns.push(turn)
  }
  if (turns.length === 0) return 1
  turns.sort((x, y) => x - y)
  return clamp(1 - turns[Math.floor(turns.length / 2)] / config.smoothTurnRad, 0, 1)
}

// Line confidence: the mean of smoothness and "1 - how many strokes just went over an earlier one".
function lineConfidence(strokes: Point[][]): number {
  if (strokes.length === 0) return 0
  const smooth = strokes.reduce((sum, s) => sum + smoothness(s), 0) / strokes.length
  let overstrokes = 0
  const earlier: Point[] = []
  const limit = config.overstrokeDistance ** 2
  for (const stroke of strokes) {
    const points = resample(stroke, config.alignPointsPerStroke)
    if (earlier.length > 0) {
      const close = points.filter((p) => earlier.some((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= limit)).length
      if (close / points.length >= config.overstrokeShare) overstrokes++
    }
    earlier.push(...points)
  }
  return clamp((smooth + (1 - overstrokes / strokes.length)) / 2, 0, 1)
}

function missingPart(partId: string, label: string): PartMetric {
  return {
    partId, label, missing: true, sizeError: 0, offset: { dx: 0, dy: 0 }, aspectError: 0, tiltDeg: 0, good: false, userBox: null,
  }
}

export function analyze(pack: Pack, strokes: UserStroke[]): Analysis {
  const drawn = strokes.filter((s) => s.points.length >= 2)
  const usedFallback = pack.parts.length === 0
  if (drawn.length === 0) {
    return {
      parts: pack.parts.map((p) => missingPart(p.id, p.label)), shapeSimilarity: 0, lineConfidence: 0,
      overallScale: 1, overallOffset: { dx: 0, dy: 0 }, alignedStrokes: [], usedFallback,
    }
  }

  // 1. Align the whole drawing with the target.
  const target = targetPoints(pack)
  const raw = drawn.map((s) => s.points.map(([x, y]): Point => [x, y]))
  const { transform, overallScale, overallOffset } = align(raw, target)
  const aligned = raw.map((s) => s.map((p) => applyTransform(transform, p)))
  const alignedStrokes: UserStroke[] = drawn.map((s, k) => ({
    points: s.points.map((p, i): TimedPoint => [round2(aligned[k][i][0]), round2(aligned[k][i][1]), p[2], p[3]]),
  }))

  const targetBox = bbox(target)
  const targetDiagonal = diagonal(targetBox) || pack.size
  const userAll = aligned.flatMap((s) => resample(s, config.alignPointsPerStroke))
  const userDiagonal = diagonal(bbox(userAll)) || targetDiagonal
  const height = targetBox[3] || 1

  // 2. Give each stroke to the part whose plan lines it sits closest to. Strokes far from every part are ignored.
  const partSets = partPointSets(pack)
  const assigned = new Map<string, Point[]>()
  for (const stroke of aligned) {
    const points = resample(stroke, config.alignPointsPerStroke)
    let bestPart: string | null = null
    let bestDistance = Infinity
    for (const [partId, partPoints] of partSets) {
      const d = meanNearest(points, partPoints)
      if (d < bestDistance) {
        bestDistance = d
        bestPart = partId
      }
    }
    if (bestPart && bestDistance <= config.partMaxDistance * targetDiagonal) {
      assigned.set(bestPart, [...(assigned.get(bestPart) ?? []), ...points])
    }
  }

  // 3. Measure each part: size relative to the whole drawing, position, width/height ratio and tilt.
  const parts = pack.parts.map((part): PartMetric => {
    const userPoints = assigned.get(part.id)
    if (!userPoints || userPoints.length === 0) return missingPart(part.id, part.label)
    const planPoints = partSets.get(part.id) ?? []
    const tBox = bbox(planPoints)
    const uBox = bbox(userPoints)
    // Sizes are compared as a share of each drawing, so the whole drawing's scale never counts against the user.
    const sizeError = (diagonal(uBox) / userDiagonal) / (Math.max(diagonal(tBox), 1) / targetDiagonal) - 1
    const [ux, uy] = boxCenter(uBox)
    const [tx, ty] = boxCenter(tBox)
    const offset = { dx: (ux - tx) / height, dy: (uy - ty) / height }
    const ratio = (b: Box) => Math.max(b[2], 8) / Math.max(b[3], 8) // 8 px floor: a flat line has no ratio
    const aspectError = ratio(uBox) / ratio(tBox) - 1
    const targetAxis = principalAxis(planPoints)
    const tiltDeg = targetAxis.elongation < config.roundPartRatio
      ? 0 // a round part (a head circle) has no reliable tilt
      : angleDifference(principalAxis(userPoints).angleDeg, targetAxis.angleDeg)
    const good = Math.max(Math.abs(sizeError), Math.abs(offset.dx), Math.abs(offset.dy), Math.abs(aspectError)) <= config.goodLimit
      && Math.abs(tiltDeg) <= config.goodTiltDeg
    return {
      partId: part.id,
      label: part.label,
      missing: false,
      sizeError: round2(sizeError),
      offset: { dx: round2(offset.dx), dy: round2(offset.dy) },
      aspectError: round2(aspectError),
      tiltDeg: Math.round(tiltDeg),
      good,
      userBox: [Math.round(uBox[0]), Math.round(uBox[1]), Math.round(uBox[2]), Math.round(uBox[3])],
    }
  })

  // 4. Whole-drawing scores.
  const shapeSimilarity = clamp(1 - symmetricChamfer(userAll, target) / (config.shapeScale * targetDiagonal), 0, 1)

  return {
    parts: usedFallback ? [] : parts,
    shapeSimilarity: round2(shapeSimilarity),
    lineConfidence: round2(lineConfidence(aligned)), // aligned, so the 4 px re-stroke distance is in target space
    overallScale: round2(overallScale),
    overallOffset: { dx: round2(overallOffset.dx), dy: round2(overallOffset.dy) },
    alignedStrokes,
    usedFallback,
  }
}
