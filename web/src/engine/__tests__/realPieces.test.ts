// A line drawn in several strokes is judged as one line: every piece scores against the line it belongs to
// (including the piece that finishes it).
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { createTeacher } from '../real/teacher'
import { realEngine } from '../real'
import type { Pack, TimedPoint } from '../types'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs: Pack[] = Object.entries(files).map(([path, text]) => parsePack(JSON.parse(text as string), path))

describe('a line drawn in pieces', () => {
  it.each(packs.map((p) => ({ name: p.id, pack: p })))('scores every piece of $name against its line', ({ pack }) => {
    const steps = realEngine.buildLesson(pack, [])
    const teacher = createTeacher(pack, steps, 'guided')
    let lines = 0
    for (let k = 0; k < 6 && !teacher.state().done; k++) {
      // The first full guide on screen, drawn in three pieces (a little off, like a real hand).
      const guide = teacher.showMe().find((g) => g.points.length >= 12)
      if (!guide) break
      const n = guide.points.length
      const cuts = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]
      for (let i = 0; i < 3; i++) {
        const pts = guide.points.slice(cuts[i], cuts[i + 1] + 1)
        const result = teacher.addStroke({ points: pts.map(([x, y], j): TimedPoint => [x + 5, y + 3, 0.5, j * 16]) })
        expect(result.accuracy, `${guide.strokeId} piece ${i + 1}`).not.toBeNull()
        expect(result.accuracy!, `${guide.strokeId} piece ${i + 1}`).toBeGreaterThan(0.75)
      }
      lines++
    }
    expect(lines).toBeGreaterThan(0)
  })
})
