// "Forgot the handle" for a handle that was drawn: a small part drawn a little off (moved, a bit small) sits
// nearer a big neighbouring outline than its own lines, and used to lose its strokes to that outline. analyze()
// now gives such a part back the strokes that match its shape (rescueMissingParts). A part that really was left
// out must still be reported missing.
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { analyze } from '../real/analyze'
import { bbox, boxCenter } from '../real/geometry'
import type { Pack, Point, TimedPoint, UserStroke } from '../types'

const packFiles = import.meta.glob<string>('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const load = (id: string) => parsePack(JSON.parse(packFiles[`../../../public/subjects/${id}/pack.json`]), id)

const toUser = (points: Point[]): UserStroke => ({ points: points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })

// A copy of every visible line, with some parts moved by (dx, dy) and scaled by k about their own centers.
function copyWithPartsOff(pack: Pack, moves: Record<string, [dx: number, dy: number, k: number]>): UserStroke[] {
  const visible = pack.strokes.filter((s) => s.tier !== 'construction')
  return visible.map((s) => {
    const move = s.partId === null ? undefined : moves[s.partId]
    if (!move) return toUser(s.points)
    const [dx, dy, k] = move
    const [cx, cy] = boxCenter(bbox(visible.filter((q) => q.partId === s.partId).flatMap((q) => q.points)))
    return toUser(s.points.map(([x, y]): Point => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]))
  })
}

const copyWithPartOff = (pack: Pack, partId: string, dx: number, dy: number, k = 1) => copyWithPartsOff(pack, { [partId]: [dx, dy, k] })

const copyWithout = (pack: Pack, partId: string) =>
  pack.strokes.filter((s) => s.tier !== 'construction' && s.partId !== partId).map((s) => toUser(s.points))

const missing = (strokes: UserStroke[], pack: Pack, partId: string) => analyze(pack, strokes).parts.find((p) => p.partId === partId)!.missing

describe('a part drawn a little off is not reported missing', () => {
  const cases = [
    { pack: 'mug-medium', part: 'handle', dx: -30, dy: 0, k: 0.8, why: 'handle drawn 30 px in, toward the body, and a bit small' },
    { pack: 'house-medium', part: 'chimney', dx: 0, dy: -25, k: 1, why: 'chimney drawn 25 px high' },
    { pack: 'face-medium', part: 'mouth', dx: 0, dy: 20, k: 1.15, why: 'mouth drawn 20 px low and a bit big' },
  ]
  it.each(cases)('$pack: $why', ({ pack: id, part, dx, dy, k }) => {
    const pack = load(id)
    expect(missing(copyWithPartOff(pack, part, dx, dy, k), pack, part)).toBe(false)
  })
  it.each(cases)('$pack: the $part left out is still missing', ({ pack: id, part }) => {
    const pack = load(id)
    expect(missing(copyWithout(pack, part), pack, part)).toBe(true)
  })

  it('house-medium: a chimney drawn 60 px left, with the roof drawn 25 px low (the roof took the chimney line)', () => {
    // The chimney's only plan line is its top. The roof drawn low lost its own lines to the wall and got the
    // chimney's top instead, as its only stroke: the chimney may still take it back.
    const pack = load('house-medium')
    expect(missing(copyWithPartsOff(pack, { chimney: [-60, 0, 1], roof: [0, 25, 1] }), pack, 'chimney')).toBe(false)
  })

  it('fish-medium: a top fin drawn 60 px left and 60 px low (it also looks a bit like a body line)', () => {
    const pack = load('fish-medium')
    expect(missing(copyWithPartOff(pack, 'fin_top', -60, 60), pack, 'fin_top')).toBe(false)
    expect(missing(copyWithout(pack, 'fin_top'), pack, 'fin_top')).toBe(true)
  })
})
