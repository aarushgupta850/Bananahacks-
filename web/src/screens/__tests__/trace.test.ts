import { describe, expect, it } from 'vitest'
import type { PlanStroke, Point, Step } from '../../engine/types'
import { fitSimilarity, guideMovement, traceStrokes } from '../trace'

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

describe('traceStrokes', () => {
  const s = (id: string, partId: string | null, tier: PlanStroke['tier'] = 'outline'): PlanStroke =>
    ({ id, partId, tier, points: [[0, 0], [10, 10]], keyPoints: [] })
  const strokes = [s('c1', 'head', 'construction'), s('h1', 'head'), s('h2', 'head', 'detail'), s('b1', 'body'), s('x', null)]
  const steps: Step[] = [
    { id: '1', label: '', tip: '', tier: 'construction', strokeIds: ['c1'] },
    { id: '2', label: '', tip: '', tier: 'outline', strokeIds: ['b1'] },
    { id: '3', label: '', tip: '', tier: 'detail', strokeIds: ['x'] },
  ]
  const ids = (i: number) => traceStrokes(strokes, steps, i).map((t) => t.id)

  it('on a construction step, traces the real lines of that part only', () => {
    expect(ids(0)).toEqual(['h1', 'h2'])
  })

  it('reveals more as the lesson goes on, and never construction shapes', () => {
    expect(ids(1)).toEqual(['h1', 'h2', 'b1'])
    expect(ids(2)).toEqual(['h1', 'h2', 'b1', 'x'])
  })
})
