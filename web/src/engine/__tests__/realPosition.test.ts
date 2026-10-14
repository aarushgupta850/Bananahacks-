// Where a solo drawing sits on the canvas must not change its score. A careful copy drawn off to one side scores
// what it scores in place, and so do Aarush's real fox drawings (before the many-start alignment, the careful fox
// fell from 81 to 34 when drawn 200 px lower). Size does count (draw it to scale), within 15%.
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { realEngine as engine } from '../real'
import { findWeaknesses } from '../real/lesson'
import type { Pack, UserStroke } from '../types'
import * as D from './accuracyDrawings'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs: Pack[] = Object.entries(files)
  .map(([path, text]) => parsePack(JSON.parse(text as string), path))
  .filter((p) => !p.id.startsWith('demo'))
const fixtures = import.meta.glob('./fixtures/*.json', { import: 'default', eager: true }) as Record<string, { strokes: UserStroke[] }>

const total = (p: Pack, strokes: UserStroke[]) => engine.score(engine.analyze(p, strokes)).total
// [scale, dx, dy]: somewhere else on the canvas, to scale or within the 15% size tolerance.
const MOVES: [number, number, number][] = [[1, 150, 100], [1, -150, -100], [1, 200, 0], [0.9, 150, 100], [1.1, -200, 120]]

describe('a drawing scores the same wherever it is drawn', () => {
  it.each(packs.map((p) => [p.id, p] as const))('%s: a careful copy, moved', (_, p) => {
    const copy = D.perfectCopy(p)
    const inPlace = total(p, copy)
    for (const [scale, dx, dy] of MOVES) {
      const moved = engine.analyze(p, D.transformed(copy, p, scale, dx, dy))
      expect(Math.abs(engine.score(moved).total - inPlace), `${scale} ${dx},${dy}`).toBeLessThanOrEqual(3)
      expect(findWeaknesses(p, moved).some((w) => w.kind === 'position'), `${scale} ${dx},${dy}`).toBe(false)
    }
  }, 20_000)

  it.each(packs.map((p) => [p.id, p] as const))('%s: half a drawing, moved', (_, p) => {
    const half = D.partial(p, 0.5)
    const inPlace = total(p, half)
    for (const [dx, dy] of [[150, 100], [-180, 60]]) {
      expect(Math.abs(total(p, D.transformed(half, p, 1, dx, dy)) - inPlace)).toBeLessThanOrEqual(3)
    }
  }, 20_000)

  it.each(Object.entries(fixtures))('real drawing %s, moved', (_, { strokes }) => {
    const fox = packs.find((p) => p.id === 'fox-medium')!
    const inPlace = total(fox, strokes)
    for (const [scale, dx, dy] of [[1, -150, -60], [1, 100, 100], [1, 0, 200]] as const) {
      // Within 5: the careless fox (about 14 points) barely looks like a fox, so its fitted size wobbles a little.
      expect(Math.abs(total(fox, D.transformed(strokes, fox, scale, dx, dy)) - inPlace), `${scale} ${dx},${dy}`).toBeLessThanOrEqual(5)
    }
  }, 20_000)

  it.each(packs.map((p) => [p.id, p] as const))('%s: drawn 40%% too small, anywhere, costs the same and says so', (_, p) => {
    const copy = D.perfectCopy(p)
    const small = [[0, 0], [150, 100], [-150, -60]].map(([dx, dy]) => engine.analyze(p, D.transformed(copy, p, 0.6, dx, dy)))
    const totals = small.map((a) => engine.score(a).total)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(3)
    expect(Math.max(...totals)).toBeLessThan(total(p, copy) - 10)
    for (const a of small) expect(findWeaknesses(p, a).some((w) => w.partId === null && w.kind === 'size')).toBe(true)
  }, 20_000)

  it('moving scribbles or random lines around does not make them score', () => {
    for (const p of packs) {
      expect(total(p, D.scribbles(p))).toBeLessThanOrEqual(5)
      expect(total(p, D.randomLines(p))).toBeLessThanOrEqual(45)
    }
  }, 20_000)
})
