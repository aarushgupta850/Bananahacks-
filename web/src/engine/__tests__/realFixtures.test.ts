// M2: real drawings, exported with ?dev=1 and saved in fixtures/ (see fixtures/README.md), scored with the
// real engine. For each pack and person: careful > rough > careless, and careful scores at least 80.
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { analyze } from '../real/analyze'
import { score } from '../real/lesson'
import type { UserStroke } from '../types'

const QUALITIES = ['careless', 'rough', 'careful'] as const
type Quality = (typeof QUALITIES)[number]

const drawings = import.meta.glob<{ strokes: UserStroke[] }>('./fixtures/*.json', { eager: true, import: 'default' })
const packFiles = import.meta.glob<string>('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })

// "./fixtures/fox-medium--careful--aarush.json" -> { packId: "fox-medium", quality: "careful", who: "aarush" }
const parsed = Object.entries(drawings).map(([path, file]) => {
  const [packId, quality, who] = path.split('/').pop()!.replace(/\.json$/, '').split('--')
  return { path, packId, quality: quality as Quality, who, strokes: file.strokes }
})
const groups = new Map<string, typeof parsed>()
for (const d of parsed) groups.set(`${d.packId} by ${d.who}`, [...(groups.get(`${d.packId} by ${d.who}`) ?? []), d])

describe('real drawings (M2 fixtures)', () => {
  it('are named <packId>--<careless|rough|careful>--<who>.json and point at a pack that exists', () => {
    for (const d of parsed) {
      expect(QUALITIES, d.path).toContain(d.quality)
      expect(d.who, d.path).toBeTruthy()
      expect(packFiles[`../../../public/subjects/${d.packId}/pack.json`], d.path).toBeDefined()
    }
  })

  for (const [name, group] of groups) {
    it(`ranks ${name}: careful > rough > careless, careful >= 80`, () => {
      const pack = parsePack(JSON.parse(packFiles[`../../../public/subjects/${group[0].packId}/pack.json`]), group[0].packId)
      const totals = new Map(group.map((d) => [d.quality, score(analyze(pack, d.strokes)).total]))
      const ordered = QUALITIES.filter((q) => totals.has(q)).map((q) => totals.get(q)!)
      for (let i = 1; i < ordered.length; i++) expect(ordered[i], JSON.stringify(Object.fromEntries(totals))).toBeGreaterThan(ordered[i - 1])
      if (totals.has('careful')) expect(totals.get('careful')!).toBeGreaterThanOrEqual(80)
    })
  }
})
