// A4d: weaknesses, lesson order, score and coaching, on the demo fox pack.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import { parsePack } from '../../lib/packs'
import { realEngine as engine } from '../real'
import type { Pack, PlanStroke, Point, TimedPoint, UserStroke } from '../types'

const pack = parsePack(JSON.parse(packText), 'demo pack')
const visible = pack.strokes.filter((s) => s.tier !== 'construction')
const toUser = (points: Point[]): UserStroke => ({ points: points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })
const scaleAbout = (points: Point[], [cx, cy]: Point, k: number) => points.map(([x, y]): Point => [cx + (x - cx) * k, cy + (y - cy) * k])
const copyOf = (change: (s: PlanStroke) => Point[] = (s) => s.points, strokes = visible) => strokes.map((s) => toUser(change(s)))

const headBox = pack.parts.find((p) => p.id === 'head')!.box
const headCenter: Point = [headBox[0] + headBox[2] / 2, headBox[1] + headBox[3] / 2]
const bigHead = (k: number) => copyOf((s) => (s.partId === 'head' ? scaleAbout(s.points, headCenter, k) : s.points))

describe('real score', () => {
  it('scores an exact copy at least 95', () => {
    expect(engine.score(engine.analyze(pack, copyOf())).total).toBeGreaterThanOrEqual(95)
  })

  it('scores a copy drawn 30% smaller at least 90', () => {
    expect(engine.score(engine.analyze(pack, copyOf((s) => scaleAbout(s.points, [384, 384], 0.7)))).total).toBeGreaterThanOrEqual(90)
  })

  it('scores an empty drawing 0', () => {
    expect(engine.score(engine.analyze(pack, [])).total).toBe(0)
  })
})

describe('real findWeaknesses', () => {
  it('puts an oversized head at the top', () => {
    const weak = engine.findWeaknesses(pack, engine.analyze(pack, bigHead(1.3)))
    expect(weak[0]).toMatchObject({ partId: 'head', kind: 'size' })
    expect(weak[0].message).toMatch(/Head \d+% too big/)
    expect(weak.length).toBeLessThanOrEqual(3)
  })

  it('ranks a missing part first', () => {
    const drawing = bigHead(1.3).filter((_, i) => visible[i].partId !== 'tail')
    const weak = engine.findWeaknesses(pack, engine.analyze(pack, drawing))
    expect(weak[0]).toMatchObject({ partId: 'tail', kind: 'missing', message: 'Forgot the tail' })
  })

  it('finds nothing to fix in an exact copy', () => {
    expect(engine.findWeaknesses(pack, engine.analyze(pack, copyOf()))).toEqual([])
  })
})

describe('real buildLesson', () => {
  it('keeps construction first and moves the weak part earlier within its tier', () => {
    const weak = [{ partId: 'tail', kind: 'size' as const, severity: 0.3, message: 'Tail 30% too big' }]
    const steps = engine.buildLesson(pack, weak)
    expect(steps).toHaveLength(pack.steps.length)
    expect(steps[0].tier).toBe('construction')
    const firstOutline = steps.find((s) => s.tier === 'outline')!
    const tailIds = new Set(pack.strokes.filter((s) => s.partId === 'tail').map((s) => s.id))
    if (pack.steps.some((s) => s.tier === 'outline' && s.strokeIds.some((id) => tailIds.has(id)))) {
      expect(firstOutline.strokeIds.some((id) => tailIds.has(id))).toBe(true)
    }
    expect(steps.some((s) => s.tip.startsWith('Last time: Tail 30% too big'))).toBe(true)
  })
})

describe('real coach', () => {
  it('marks a fixed head as improved and lists strengths', () => {
    const test = engine.analyze(pack, bigHead(1.3))
    const retest = engine.analyze(pack, bigHead(1.04))
    const coaching = engine.coach(pack, test, retest)
    const head = coaching.fix.find((f) => f.partId === 'head')!
    expect(head.status).toBe('improved')
    expect(head.text).toMatch(/^Head size: \d+% too big → \d+%$/)
    expect(coaching.good.length).toBeGreaterThan(0)
    expect(coaching.good.every((g) => g.status === 'good')).toBe(true)
  })

  it('marks an unchanged problem as not yet', () => {
    const test = engine.analyze(pack, bigHead(1.3))
    const coaching = engine.coach(pack, test, engine.analyze(pack, bigHead(1.28)))
    expect(coaching.fix.find((f) => f.partId === 'head')?.status).toBe('not-yet')
  })
})

describe('a pack without parts', () => {
  it('still analyzes, scores and coaches', () => {
    const noParts: Pack = { ...pack, parts: [], strokes: pack.strokes.map((s) => ({ ...s, partId: null })) }
    const analysis = engine.analyze(noParts, copyOf())
    expect(engine.score(analysis).total).toBeGreaterThanOrEqual(90)
    expect(engine.findWeaknesses(noParts, analysis)).toEqual([])
    expect(() => engine.coach(noParts, analysis, analysis)).not.toThrow()
    expect(() => engine.buildLesson(noParts, [])).not.toThrow()
  })
})
