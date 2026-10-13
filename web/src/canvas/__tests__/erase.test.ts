import { describe, expect, it } from 'vitest'
import type { TimedPoint, UserStroke } from '../../engine/types'
import { eraseAlong } from '../erase'

const line = (x0: number, x1: number, y = 100): UserStroke =>
  ({ points: [[x0, y, 0.5, 0], [x1, y, 0.5, 100]] as TimedPoint[] })
const span = (s: UserStroke) => [Math.round(s.points[0][0]), Math.round(s.points.at(-1)![0])]

describe('eraseAlong', () => {
  it('cuts a line in two where the eraser crosses its middle', () => {
    const out = eraseAlong([line(0, 400)], [200, 80], [200, 120], 10)
    expect(out.map((o) => span(o.stroke))).toHaveLength(2)
    const [left, right] = out.map((o) => span(o.stroke))
    expect(left[0]).toBe(0)
    expect(left[1]).toBeLessThan(190)
    expect(right[0]).toBeGreaterThan(210)
    expect(right[1]).toBe(400)
    expect(out.every((o) => o.source === 0)).toBe(true)
  })

  it('trims only the end it touches, and leaves other lines untouched (same objects)', () => {
    const a = line(0, 400)
    const b = line(0, 400, 300)
    const out = eraseAlong([a, b], [395, 100], [420, 100], 10)
    expect(out).toHaveLength(2)
    expect(span(out[0].stroke)[1]).toBeLessThan(390)
    expect(out[1].stroke).toBe(b)
  })

  it('removes a line it covers completely, and keeps times starting at 0 for each piece', () => {
    expect(eraseAlong([line(100, 110)], [105, 100], [105, 100], 20)).toEqual([])
    const [, right] = eraseAlong([line(0, 400)], [200, 100], [200, 100], 10)
    expect(right.stroke.points[0][3]).toBe(0)
  })
})
