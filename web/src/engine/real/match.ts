// Matches one user stroke to the guide (ghost) it was meant to trace, and scores how close it came.
import type { Point } from '../types'
import { config } from './config'
import { clamp, frechetEitherWay, resample, symmetricChamfer } from './geometry'

export interface MatchCandidate {
  id: string       // the plan stroke's id
  points: Point[]  // the guide as currently shown (already adapted to the user)
}

export interface Match {
  ghostId: string
  accuracy: number     // 0-1
  user: Point[]        // the user stroke, resampled
  guide: Point[]       // the guide, resampled and turned to run the same way as the user stroke
}

// Picks the closest guide by Chamfer distance (fast, ignores drawing direction), then confirms with Frechet
// distance (which also checks the shape is traced in order). Returns null when the stroke is near no guide,
// e.g. a doodle off to the side: that costs the user nothing.
// accuracy = 1 - frechet / (accuracyScale * drawing diagonal), clamped to 0-1.
export function matchStroke(userPoints: Point[], candidates: MatchCandidate[], drawingDiagonal: number): Match | null {
  if (userPoints.length < 2 || candidates.length === 0 || drawingDiagonal <= 0) return null
  const user = resample(userPoints, config.resamplePoints)

  let best: { candidate: MatchCandidate; guide: Point[]; chamfer: number } | null = null
  for (const candidate of candidates) {
    if (candidate.points.length === 0) continue
    const guide = resample(candidate.points, config.resamplePoints)
    const chamfer = symmetricChamfer(user, guide)
    if (!best || chamfer < best.chamfer) best = { candidate, guide, chamfer }
  }
  if (!best || best.chamfer > config.matchMaxChamfer * drawingDiagonal) return null

  const { distance, reversed } = frechetEitherWay(user, best.guide)
  const accuracy = clamp(1 - distance / (config.accuracyScale * drawingDiagonal), 0, 1)
  return {
    ghostId: best.candidate.id,
    accuracy,
    user,
    guide: reversed ? [...best.guide].reverse() : best.guide,
  }
}
