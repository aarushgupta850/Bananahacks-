// An unfinished drawing must not score like a finished one. Before this, the shape score only measured how close
// the drawn lines were to the drawing, so a copy missing a third of its lines scored 97 (the lines left out lie
// close to lines that were drawn). Now the shape score also counts how much of the drawing was drawn.
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { realEngine as engine } from '../real'
import type { Pack, TimedPoint, UserStroke } from '../types'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs: Pack[] = Object.entries(files).map(([path, text]) => parsePack(JSON.parse(text as string), path))
  .filter((p) => !p.id.startsWith('demo'))

const copy = (pack: Pack, keep: (i: number) => boolean): UserStroke[] => pack.strokes
  .filter((s) => s.tier !== 'construction')
  .filter((_, i) => keep(i))
  .map((s) => ({ points: s.points.map(([x, y], j): TimedPoint => [x + 3, y + 2, 0.5, j * 16]) }))

describe('an unfinished drawing', () => {
  it.each(packs.map((p) => ({ name: p.id, pack: p })))('scores clearly lower than a finished one: $name', ({ pack }) => {
    const whole = engine.score(engine.analyze(pack, copy(pack, () => true)))
    // Every other line left out, taking the lines longest first, so about half of the drawing's length goes
    // missing in every pack. (Every other line in pack order left out only 20% of mug-medium's length: its
    // long lines happen to sit at even positions, and the short odd ones retrace parts of them.)
    const strokes = pack.strokes.filter((s) => s.tier !== 'construction')
    const len = (pts: [number, number][]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
    const byLength = strokes.map((s, i) => ({ i, length: len(s.points) })).sort((a, b) => b.length - a.length)
    const kept = new Set(byLength.filter((_, rank) => rank % 2 === 0).map((s) => s.i))
    const half = engine.score(engine.analyze(pack, copy(pack, (i) => kept.has(i) && strokes.length > 2)))
    expect(whole.total).toBeGreaterThanOrEqual(95)
    expect(half.shape).toBeLessThan(whole.shape - 0.15)
    expect(half.total).toBeLessThan(whole.total - 5)
  })
})

// Scribbles must not score like a drawing. Zigzags over each part scored up to 84 and random scribbles 56-75,
// above a real careless drawing (25).
describe('scribbles', () => {
  const timed = (pts: [number, number][]): UserStroke => ({ points: pts.map(([x, y], j): TimedPoint => [x, y, 0.5, j * 16]) })
  it.each(packs.map((p) => ({ name: p.id, pack: p })))('score low: $name', ({ pack }) => {
    // A zigzag filling each part's box.
    const zigzags = pack.parts.map((p) => {
      const [x, y, w, h] = p.box
      return timed(Array.from({ length: 16 }, (_, i): [number, number] => [x + (i % 2) * w, y + (i / 15) * h]))
    })
    // Scribbled loops all over the drawing.
    const loops = Array.from({ length: 8 }, (_, k) => {
      const [cx, cy, r] = [200 + (k % 4) * 110, 250 + Math.floor(k / 4) * 200, 60]
      return timed(Array.from({ length: 40 }, (_, i): [number, number] => [cx + r * Math.cos(i / 3), cy + r * Math.sin(i / 3.3)]))
    })
    if (zigzags.length > 0) expect(engine.score(engine.analyze(pack, zigzags)).total).toBeLessThan(20)
    expect(engine.score(engine.analyze(pack, loops)).total).toBeLessThan(35)
  })
})
