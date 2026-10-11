// Checks the hand-made demo pack (built by web/scripts/make-demo-pack.mjs) against the contract.
// The canvas test page and these tests still use it, even after real packs replace it in index.json
// (subjectIndex.test.ts checks whatever index.json lists).
// The files are imported with Vite's ?raw suffix, which hands over the file text as a string.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import targetSvg from '../../../public/subjects/demo-fox-medium/target.svg?raw'
import thumbSvg from '../../../public/subjects/demo-fox-medium/thumb.svg?raw'
import { parsePack } from '../../lib/packs'
import { createMockEngine } from '../mock'
import type { Point } from '../types'
import { strokeAt } from './fixtures'

const PACK_ID = 'demo-fox-medium'
const pack = parsePack(JSON.parse(packText), `pack "${PACK_ID}"`)

// Every <polyline points="x,y x,y ..."> in an SVG, as lists of points. (Node has no DOMParser, so a regex it is.)
function polylines(svg: string): Point[][] {
  return [...svg.matchAll(/points="([^"]*)"/g)].map((match) =>
    match[1].trim().split(/\s+/).map((pair): Point => {
      const [x, y] = pair.split(',').map(Number)
      return [x, y]
    }))
}

describe('demo fox pack', () => {
  it('matches the contract, and its id matches its folder', () => {
    // parsePack (above) already threw if any field had the wrong shape.
    expect(pack.id).toBe(PACK_ID)
    expect(pack.size).toBe(768)
    expect(pack.difficulty).toBe('medium')
  })

  it('has 12 strokes in 6 steps, and the five parts', () => {
    expect(pack.strokes).toHaveLength(12)
    expect(pack.steps).toHaveLength(6)
    expect(pack.parts.map((p) => p.id)).toEqual(['head', 'body', 'ears', 'eyes', 'tail'])
  })

  it('gives every stroke key points and keeps every point inside the 768 x 768 space', () => {
    const inside = ([x, y]: Point) => x >= 0 && x <= 768 && y >= 0 && y <= 768
    for (const stroke of pack.strokes) {
      expect(stroke.keyPoints.length, stroke.id).toBeGreaterThan(0)
      expect(stroke.points.length, stroke.id).toBeGreaterThan(1)
      expect([...stroke.points, ...stroke.keyPoints].every(inside), stroke.id).toBe(true)
    }
    for (const part of pack.parts) {
      const [x, y, w, h] = part.box
      expect(inside([x, y]) && inside([x + w, y + h]), part.id).toBe(true)
    }
  })

  it('puts every stroke in exactly one step, starting with the construction shapes', () => {
    const used = pack.steps.flatMap((s) => s.strokeIds)
    expect([...used].sort()).toEqual(pack.strokes.map((s) => s.id).sort())
    const first = pack.steps[0]
    expect(first.tier).toBe('construction')
    const firstStrokes = pack.strokes.filter((s) => first.strokeIds.includes(s.id))
    expect(firstStrokes.map((s) => [s.tier, s.partId])).toEqual([['construction', 'head'], ['construction', 'body']])
  })

  it('describes all six pipeline stages in text only', () => {
    expect(pack.pipeline.map((s) => s.id)).toEqual(['source', 'candidates', 'chosen', 'skeleton', 'parts', 'order'])
    for (const stage of pack.pipeline) {
      expect(stage.text?.length, stage.id).toBeGreaterThan(0)
      expect(stage.image, stage.id).toBeUndefined()
      expect(stage.images, stage.id).toBeUndefined()
    }
  })

  it('draws target.svg and thumb.svg from the same points as the plan (construction left out)', () => {
    const drawn = pack.strokes.filter((s) => s.tier !== 'construction').map((s) => s.points)
    expect(polylines(targetSvg)).toEqual(drawn)
    expect(polylines(thumbSvg)).toEqual(drawn)
  })

  it('runs a whole lesson on the mock engine', () => {
    const engine = createMockEngine()
    const steps = engine.buildLesson(pack, [])
    const teacher = engine.createTeacher(pack, steps, 'guided')
    expect(teacher.state().ghosts.map((g) => g.strokeId)).toEqual(['c-head', 'c-body'])
    const results = steps.map((_, i) => teacher.addStroke(strokeAt(100 + i * 10, 100)))
    expect(results[results.length - 1].done).toBe(true)
  })
})
