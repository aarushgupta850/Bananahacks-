import { describe, expect, it } from 'vitest'
import type { TimedPoint, UserStroke } from '../../engine/types'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import { analyze } from '../../engine/real/analyze'
import { parsePack } from '../../lib/packs'
import { eraseAlong } from '../erase'

// A horizontal stroke at height y from x0 to x1, with a point every `step` px (time = x, pressure 0.5).
function line(y: number, x0: number, x1: number, step: number): UserStroke {
  const points: TimedPoint[] = []
  for (let x = x0; x <= x1; x += step) points.push([x, y, 0.5, x])
  return { points }
}

describe('eraseAlong', () => {
  it('splits a stroke cut in the middle into two pieces', () => {
    const stroke = line(100, 0, 200, 2)
    // A vertical swipe across x = 100.
    const result = eraseAlong([stroke], [[100, 50], [100, 150]], 10)
    expect(result).toHaveLength(2)
    const [left, right] = result
    // Everything within 10 px of x = 100 is gone; the rest is untouched.
    expect(left.points[0]).toEqual([0, 100, 0.5, 0])
    expect(left.points.at(-1)![0]).toBeLessThan(90)
    expect(right.points[0][0]).toBeGreaterThan(110)
    expect(right.points.at(-1)).toEqual([200, 100, 0.5, 200])
  })

  it('shortens a stroke erased at one end into a single piece', () => {
    const result = eraseAlong([line(100, 0, 200, 2)], [[200, 100]], 20)
    expect(result).toHaveLength(1)
    expect(result[0].points[0][0]).toBe(0)
    expect(result[0].points.at(-1)![0]).toBeLessThan(180)
  })

  it('returns the same list and stroke objects when the eraser misses', () => {
    const strokes = [line(100, 0, 200, 2), line(300, 0, 200, 2)]
    const result = eraseAlong(strokes, [[100, 500], [400, 500]], 14)
    expect(result).toBe(strokes)
  })

  it('keeps untouched strokes as the same objects next to cut ones', () => {
    const near = line(100, 0, 200, 2)
    const far = line(400, 0, 200, 2)
    const result = eraseAlong([near, far], [[100, 100]], 10)
    expect(result).toHaveLength(3)
    expect(result[2]).toBe(far)
  })

  it('cuts a long straight segment that has only its two end points', () => {
    const stroke: UserStroke = { points: [[0, 100, 0.2, 0], [600, 100, 0.8, 600]] }
    const result = eraseAlong([stroke], [[300, 100]], 14)
    expect(result).toHaveLength(2)
    const [left, right] = result
    expect(left.points[0]).toEqual([0, 100, 0.2, 0])
    // The new ends sit just outside the eraser, with pressure and time blended along the segment.
    const end = left.points.at(-1)!
    expect(end[0]).toBeGreaterThan(280)
    expect(end[0]).toBeLessThan(300 - 14)
    expect(end[2]).toBeCloseTo(0.2 + 0.6 * (end[0] / 600), 2)
    expect(end[3]).toBe(Math.round(end[0]))
    expect(right.points[0][0]).toBeGreaterThan(314)
    expect(right.points.at(-1)).toEqual([600, 100, 0.8, 600])
  })

  it('drops pieces left with fewer than 2 points', () => {
    // A short stroke almost entirely under the eraser: the leftover single points vanish.
    const stroke: UserStroke = { points: [[0, 0, 0.5, 0], [10, 0, 0.5, 10], [20, 0, 0.5, 20]] }
    expect(eraseAlong([stroke], [[10, 0]], 9.5)).toEqual([])
  })

  it('erases along the whole eraser path, not only at its points', () => {
    // Two far-apart eraser points: the stroke between them crosses the eraser segment, not a point.
    const vertical: UserStroke = { points: [[300, 0, 0.5, 0], [300, 600, 0.5, 600]] }
    const result = eraseAlong([vertical], [[0, 300], [600, 300]], 5)
    expect(result).toHaveLength(2)
  })

  it('tells the caller which pieces came from which stroke', () => {
    const stroke = line(100, 0, 200, 2)
    const seen: [UserStroke, number][] = []
    const result = eraseAlong([stroke], [[100, 100]], 10, (original, pieces) => seen.push([original, pieces.length]))
    expect(seen).toEqual([[stroke, 2]])
    expect(result).toHaveLength(2)
  })

  it('stays fast on strokes with thousands of points', () => {
    const strokes = Array.from({ length: 20 }, (_, i) => line(i * 30, 0, 768, 0.25)) // 20 strokes x ~3000 points
    const start = performance.now()
    for (let x = 0; x < 768; x += 8) eraseAlong(strokes, [[x, 0], [x + 8, 600]], 14)
    // 96 eraser moves over 60,000 points; generous bound so slow CI machines pass.
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

describe('erased drawings still analyze', () => {
  it('gives the engine split strokes it can measure', () => {
    const pack = parsePack(JSON.parse(packText), 'demo pack')
    // A full copy of the fox, then a few eraser dabs across it.
    const copy = pack.strokes
      .filter((s) => s.tier !== 'construction')
      .map((s): UserStroke => ({ points: s.points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) }))
    let erased = copy
    for (const dab of [[300, 300], [400, 350], [384, 500]] as [number, number][]) erased = eraseAlong(erased, [dab], 14)
    expect(erased).not.toBe(copy)
    expect(erased.every((s) => s.points.length >= 2)).toBe(true)
    const result = analyze(pack, erased)
    expect(Number.isFinite(result.shapeSimilarity)).toBe(true)
    expect(result.alignedStrokes).toHaveLength(erased.length)
  })
})
