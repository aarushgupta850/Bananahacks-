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
    // Every other line left out.
    const strokes = pack.strokes.filter((s) => s.tier !== 'construction')
    const half = engine.score(engine.analyze(pack, copy(pack, (i) => i % 2 === 0 && strokes.length > 2)))
    expect(whole.total).toBeGreaterThanOrEqual(95)
    expect(half.shape).toBeLessThan(whole.shape - 0.15)
    expect(half.total).toBeLessThan(whole.total - 5)
  })
})
