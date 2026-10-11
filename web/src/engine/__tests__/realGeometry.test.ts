// A4a: geometry and stroke matching for the real engine.
import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import {
  applyTransform, bbox, centroid, discreteFrechet, invertTransform, length, procrustes, resample, symmetricChamfer,
} from '../real/geometry'
import { matchStroke } from '../real/match'

const DIAGONAL = 600

// A gentle arc from (100, 300) to (500, 300).
const arc: Point[] = Array.from({ length: 30 }, (_, i): Point => {
  const t = i / 29
  return [100 + 400 * t, 300 - 120 * Math.sin(Math.PI * t)]
})

describe('geometry helpers', () => {
  it('resamples to evenly spaced points that keep both ends', () => {
    const out = resample([[0, 0], [100, 0]], 11)
    expect(out).toHaveLength(11)
    expect(out[0]).toEqual([0, 0])
    expect(out[10][0]).toBeCloseTo(100)
    expect(out[5][0]).toBeCloseTo(50)
  })

  it('measures length, centroid and bounding box', () => {
    expect(length([[0, 0], [3, 4]])).toBe(5)
    expect(centroid([[0, 0], [10, 20]])).toEqual([5, 10])
    expect(bbox([[10, 20], [30, 5]])).toEqual([10, 5, 20, 15])
  })

  it('gives Frechet 0 for identical lines and notices a shift', () => {
    expect(discreteFrechet(arc, arc)).toBe(0)
    const shifted = arc.map(([x, y]): Point => [x + 10, y])
    expect(discreteFrechet(arc, shifted)).toBeCloseTo(10, 0)
  })

  it('gives the same Chamfer distance whichever way a line is drawn', () => {
    const reversed = [...arc].reverse()
    expect(symmetricChamfer(arc, reversed)).toBeCloseTo(0)
  })

  it('procrustes recovers a known scale, rotation and shift', () => {
    const known = { scale: 1.3, rotation: 0.1, tx: 40, ty: -25 }
    const pairs = arc.map((p) => ({ from: p, to: applyTransform(known, p) }))
    const fit = procrustes(pairs, 20)
    expect(fit.scale).toBeCloseTo(1.3, 3)
    expect(fit.rotation).toBeCloseTo(0.1, 3)
    expect(fit.tx).toBeCloseTo(40, 1)
    expect(fit.ty).toBeCloseTo(-25, 1)
  })

  it('procrustes clamps the rotation', () => {
    const pairs = arc.map((p) => ({ from: p, to: applyTransform({ scale: 1, rotation: 0.5, tx: 0, ty: 0 }, p) }))
    expect(procrustes(pairs, 10).rotation).toBeCloseTo((10 * Math.PI) / 180)
  })

  it('invertTransform undoes a transform', () => {
    const t = { scale: 0.7, rotation: -0.05, tx: 12, ty: 80 }
    const [x, y] = applyTransform(invertTransform(t), applyTransform(t, [123, 456]))
    expect(x).toBeCloseTo(123)
    expect(y).toBeCloseTo(456)
  })
})

describe('matchStroke', () => {
  const ghosts = [{ id: 'arc', points: arc }]

  it('scores an identical stroke above 0.95', () => {
    expect(matchStroke(arc, ghosts, DIAGONAL)?.accuracy).toBeGreaterThan(0.95)
  })

  it('still matches a stroke drawn the other way round', () => {
    const match = matchStroke([...arc].reverse(), ghosts, DIAGONAL)
    expect(match?.ghostId).toBe('arc')
    expect(match?.accuracy).toBeGreaterThan(0.95)
  })

  it('scores a shifted copy lower, but above 0.5', () => {
    const accuracy = matchStroke(arc.map(([x, y]): Point => [x + 20, y + 15]), ghosts, DIAGONAL)?.accuracy ?? 0
    expect(accuracy).toBeLessThan(0.95)
    expect(accuracy).toBeGreaterThan(0.5)
  })

  it('returns null or a low score for an unrelated scribble', () => {
    const scribble: Point[] = Array.from({ length: 40 }, (_, i): Point => [600 + (i % 2) * 30, 650 + i * 2])
    const match = matchStroke(scribble, ghosts, DIAGONAL)
    expect(match === null || match.accuracy < 0.3).toBe(true)
  })

  it('picks the right guide among several', () => {
    const many = Array.from({ length: 10 }, (_, k) => ({ id: `g${k}`, points: arc.map(([x, y]): Point => [x, y + k * 40]) }))
    expect(matchStroke(many[6].points, many, DIAGONAL)?.ghostId).toBe('g6')
  })

  it('matches against 10 guides in under 5 ms', () => {
    const many = Array.from({ length: 10 }, (_, k) => ({ id: `g${k}`, points: arc.map(([x, y]): Point => [x, y + k * 40]) }))
    matchStroke(arc, many, DIAGONAL) // warm-up (the first call includes JIT compilation)
    const start = performance.now()
    for (let i = 0; i < 10; i++) matchStroke(arc, many, DIAGONAL)
    expect((performance.now() - start) / 10).toBeLessThan(5)
  })
})
