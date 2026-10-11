// "Skip step" must always move the lesson on, for every shipped pack and every mode, and must not change
// Auto's help level.
import { describe, expect, it } from 'vitest'
import { engine } from '../../engine'
import type { Mode, Pack, TimedPoint } from '../../engine/types'
import { parsePack } from '../../lib/packs'
import { skipStep } from '../skipStep'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs: Pack[] = Object.entries(files).map(([path, text]) => parsePack(JSON.parse(text as string), path))
const MODES: Mode[] = ['auto', 'guided', 'hints', 'checkin']

describe('skipStep', () => {
  it('finds the shipped packs', () => {
    expect(packs.length).toBeGreaterThan(3)
  })

  it.each(packs.map((p) => ({ name: p.id, pack: p })))('skips every step of $name in every mode', ({ pack }) => {
    for (const mode of MODES) {
      const steps = engine.buildLesson(pack, [])
      const teacher = engine.createTeacher(pack, steps, mode)
      let state = teacher.state()
      let skips = 0
      while (!state.done) {
        const before = state
        const { result, drawn } = skipStep(teacher, steps, mode)
        skips++
        expect(drawn.length).toBeGreaterThan(0)
        expect(result.currentStepId).not.toBe(before.currentStepId) // always progress
        expect(result.helpLevel).toBe(before.helpLevel)              // the skip itself never changes the help
        expect(skips).toBeLessThanOrEqual(steps.length)
        state = result
      }
    }
  })

  it('still works after the user has scribbled on the step', () => {
    const pack = packs[0]
    const steps = engine.buildLesson(pack, [])
    const teacher = engine.createTeacher(pack, steps, 'auto')
    for (let i = 0; i < 4; i++) {
      teacher.addStroke({ points: Array.from({ length: 20 }, (_, k): TimedPoint => [700 - k * 3, 40 + k * 5, 0.5, k * 16]) })
    }
    const before = teacher.state()
    expect(skipStep(teacher, steps, 'auto').result.currentStepId).not.toBe(before.currentStepId)
  })

  it('does nothing once the lesson is done', () => {
    const pack = packs[0]
    const steps = engine.buildLesson(pack, [])
    const teacher = engine.createTeacher(pack, steps, 'guided')
    while (!teacher.state().done) skipStep(teacher, steps, 'guided')
    expect(skipStep(teacher, steps, 'guided').drawn).toEqual([])
  })
})
