import { describe, expect, it } from 'vitest'
import type { PlanStroke, Point, Step } from '../../engine/types'
import { fitSimilarity, guideMovement, isTap, lineLength, revealFor, revealOrder, traceReveal } from '../trace'

// Regression: in the lesson, taps (which the teacher ignores) each revealed 1/12 of the trace and counted as a
// failed try, so a few clicks said "Stuck?" and a dozen showed the whole drawing.
describe('isTap', () => {
  it('treats a click, or a pen landing without moving, as a tap', () => {
    expect(isTap([[300, 300]])).toBe(true)
    expect(isTap([[300, 300], [300, 300], [301, 301]])).toBe(true)
  })

  it('treats anything that moves as a line', () => {
    expect(isTap([[300, 300], [304, 300]])).toBe(false)
    expect(isTap([[100, 100], [400, 400]])).toBe(false)
  })
})

const move = (p: Point, scale: number, angle: number, dx: number, dy: number): Point =>
  [scale * (Math.cos(angle) * p[0] - Math.sin(angle) * p[1]) + dx, scale * (Math.sin(angle) * p[0] + Math.cos(angle) * p[1]) + dy]
const apply = (s: { a: number; b: number; tx: number; ty: number }, [x, y]: Point): Point => [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty]

describe('fitSimilarity', () => {
  it('recovers a move, turn and resize exactly', () => {
    const from: Point[] = [[100, 100], [300, 120], [250, 400], [90, 380]]
    const to = from.map((p) => move(p, 1.2, 0.1, 25, -18))
    const fit = fitSimilarity(from, to)!
    from.forEach((p, i) => {
      const [x, y] = apply(fit, p)
      expect(x).toBeCloseTo(to[i][0], 6)
      expect(y).toBeCloseTo(to[i][1], 6)
    })
  })

  it('gives up on a single point', () => {
    expect(fitSimilarity([[5, 5], [5, 5]], [[9, 9], [9, 9]])).toBeNull()
  })

  it('skips key-point ghosts when reading the guides', () => {
    const plan = new Map<string, Point[]>([['a', [[0, 0], [10, 0], [10, 10]]]])
    expect(guideMovement([{ strokeId: 'a', kind: 'keypoints', points: [[1, 1], [2, 2]] }], plan)).toBeNull()
    const fit = guideMovement([{ strokeId: 'a', kind: 'stroke', points: [[5, 5], [15, 5], [15, 15]] }], plan)!
    const [x, y] = apply(fit, [0, 0])
    expect(x).toBeCloseTo(5, 9)
    expect(y).toBeCloseTo(5, 9)
  })
})

describe('traceReveal', () => {
  // Five real lines of 100 px each (one construction shape, never traced).
  const s = (id: string, partId: string | null, tier: PlanStroke['tier'] = 'outline'): PlanStroke =>
    ({ id, partId, tier, points: [[0, 0], [100, 0]], keyPoints: [] })
  const strokes = [s('c1', 'head', 'construction'), s('h1', 'head'), s('h2', 'head', 'detail'), s('b1', 'body'), s('x', null), s('y', null)]
  const steps: Step[] = [
    { id: '1', label: '', tip: '', tier: 'construction', strokeIds: ['c1'] },
    { id: '2', label: '', tip: '', tier: 'outline', strokeIds: ['b1'] },
    { id: '3', label: '', tip: '', tier: 'detail', strokeIds: ['x'] },
  ]
  const shown = (current: number, budget: number) =>
    traceReveal(strokes, steps, current, budget).map((t) => `${t.id}:${Math.round(lineLength(t.points))}`)

  it('orders lines the way the lesson reaches them, never construction shapes', () => {
    expect(revealOrder(strokes, steps).map((o) => o.stroke.id)).toEqual(['h1', 'h2', 'b1', 'x', 'y'])
  })

  it('grows bit by bit with the budget, cutting a line part-way', () => {
    expect(shown(0, 0)).toEqual([])
    expect(shown(0, 150)).toEqual(['h1:100', 'h2:50'])
    expect(shown(0, 320)).toEqual(['h1:100', 'h2:100', 'b1:100', 'x:20'])
  })

  it('always shows finished steps in full', () => {
    expect(shown(2, 0)).toEqual(['h1:100', 'h2:100', 'b1:100'])
  })

  it('reveals everything after REVEAL_STEPS short strokes', () => {
    const total = 500
    const budget = Array.from({ length: 12 }, () => revealFor(3, total)).reduce((a, b) => a + b, 0)
    expect(shown(0, budget)).toEqual(['h1:100', 'h2:100', 'b1:100', 'x:100', 'y:100'])
  })
})
