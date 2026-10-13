import { describe, expect, it } from 'vitest'
import type { PlanStroke, Point, Step } from '../../engine/types'
import { fitSimilarity, guideMovement, IDENTITY, lineLength, revealFor, revealOrder, traceMovement, traceReveal } from '../trace'

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

describe('traceMovement', () => {
  const planPoints: Point[] = [[100, 100], [300, 120], [250, 400]]
  const plan = new Map([['s1', planPoints]])
  const shifted = { strokeId: 's1', kind: 'stroke' as const, points: planPoints.map((p) => move(p, 1, 0, 40, -20)) }

  it('follows the guides on screen', () => {
    const m = traceMovement([shifted], plan, IDENTITY, false)
    expect(m.tx).toBeCloseTo(40, 6)
    expect(m.ty).toBeCloseTo(-20, 6)
  })

  it('keeps its place when the lesson is done or no full guide is shown (no snapping back)', () => {
    const before = traceMovement([shifted], plan, IDENTITY, false)
    expect(traceMovement([], plan, before, true)).toBe(before)
    expect(traceMovement([shifted], plan, before, true)).toBe(before)
    expect(traceMovement([{ ...shifted, kind: 'keypoints' }], plan, before, false)).toBe(before)
  })

  it('returns the very same movement for sub-pixel differences, so the CSS transform never changes', () => {
    const before = traceMovement([shifted], plan, IDENTITY, false)
    const nudged = { ...shifted, points: shifted.points.map(([x, y]): Point => [x + 0.001, y - 0.001]) }
    expect(traceMovement([nudged], plan, before, false)).toBe(before)
  })
})
