// A4c: whole-drawing alignment and per-part measurement, on the demo fox pack.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import { parsePack } from '../../lib/packs'
import { analyze } from '../real/analyze'
import type { Pack, PlanStroke, Point, TimedPoint, UserStroke } from '../types'

const pack = parsePack(JSON.parse(packText), 'demo pack')

// The lines a user copying the target would draw: every plan stroke except construction helpers.
const visible = pack.strokes.filter((s) => s.tier !== 'construction')

const toUser = (points: Point[]): UserStroke => ({ points: points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })

// Scales points about a center.
const scaleAbout = (points: Point[], [cx, cy]: Point, k: number) => points.map(([x, y]): Point => [cx + (x - cx) * k, cy + (y - cy) * k])

const copyOf = (strokes: PlanStroke[], change: (s: PlanStroke) => Point[] = (s) => s.points) => strokes.map((s) => toUser(change(s)))
const part = (analysis: ReturnType<typeof analyze>, id: string) => analysis.parts.find((p) => p.partId === id)!

describe('real analyze', () => {
  it('finds an exact copy good in every part, with shape similarity above 0.95', () => {
    const a = analyze(pack, copyOf(visible))
    expect(a.parts.every((p) => p.good && !p.missing)).toBe(true)
    expect(a.shapeSimilarity).toBeGreaterThan(0.95)
    expect(a.overallScale).toBeCloseTo(1, 1)
    expect(a.alignedStrokes).toHaveLength(visible.length)
  })

  it('measures every part of a fox drawn 30% smaller as right (the whole size is scored on its own)', () => {
    const a = analyze(pack, copyOf(visible, (s) => scaleAbout(s.points, [384, 384], 0.7)))
    expect(a.overallScale).toBeGreaterThan(0.65)
    expect(a.overallScale).toBeLessThan(0.75)
    expect(a.parts.every((p) => p.good)).toBe(true)
    expect(a.shapeSimilarity).toBeGreaterThan(0.9)
  })

  it('reports a head drawn 1.3x too big as about +30%', () => {
    const head = pack.parts.find((p) => p.id === 'head')!.box
    const center: Point = [head[0] + head[2] / 2, head[1] + head[3] / 2]
    const a = analyze(pack, copyOf(visible, (s) => (s.partId === 'head' ? scaleAbout(s.points, center, 1.3) : s.points)))
    expect(part(a, 'head').sizeError).toBeGreaterThan(0.2)
    expect(part(a, 'head').sizeError).toBeLessThan(0.4)
    expect(part(a, 'head').good).toBe(false)
    expect(part(a, 'body').good).toBe(true)
  })

  it('reports a tail that was left out as missing', () => {
    const a = analyze(pack, copyOf(visible.filter((s) => s.partId !== 'tail')))
    expect(part(a, 'tail').missing).toBe(true)
    expect(part(a, 'tail').userBox).toBeNull()
    expect(part(a, 'body').missing).toBe(false)
  })

  it('handles an empty drawing and a scribble without crashing', () => {
    const empty = analyze(pack, [])
    expect(empty.parts.every((p) => p.missing)).toBe(true)
    expect(empty.shapeSimilarity).toBe(0)
    const scribble = toUser(Array.from({ length: 80 }, (_, i): Point => [100 + (i % 7) * 40, 100 + i * 6]))
    const a = analyze(pack, [scribble])
    expect(a.shapeSimilarity).toBeLessThan(0.6)
    expect(Number.isFinite(a.overallScale)).toBe(true)
  })

  it('gives shaky, re-stroked lines a lower line confidence than clean ones', () => {
    const clean = analyze(pack, copyOf(visible)).lineConfidence
    const shaky = copyOf(visible, (s) => s.points.flatMap((p, i): Point[] => [p, [p[0] + (i % 2 ? 6 : -6), p[1] + 6]]))
    const doubled = [...shaky, ...shaky]
    expect(analyze(pack, doubled).lineConfidence).toBeLessThan(clean - 0.2)
  })

  it('uses the fallback for a pack without parts', () => {
    const noParts: Pack = { ...pack, parts: [], strokes: pack.strokes.map((s) => ({ ...s, partId: null })) }
    const a = analyze(noParts, copyOf(visible))
    expect(a.usedFallback).toBe(true)
    expect(a.parts).toEqual([])
    expect(a.shapeSimilarity).toBeGreaterThan(0.95)
  })
})
