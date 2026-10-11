// A4b: the real Teacher, run on the demo fox pack with synthetic strokes.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import { parsePack } from '../../lib/packs'
import { applyTransform, type Transform } from '../real/geometry'
import { createTeacher } from '../real/teacher'
import type { Point, TimedPoint, UserStroke } from '../types'

const pack = parsePack(JSON.parse(packText), 'demo pack')

// A user stroke tracing plan points, moved by an optional transform, with a little seeded wobble.
function copy(points: Point[], t: Transform = { scale: 1, rotation: 0, tx: 0, ty: 0 }, wobble = 0): UserStroke {
  return {
    points: points.map((p, i): TimedPoint => {
      const [x, y] = applyTransform(t, p)
      const jitter = wobble * Math.sin(i * 2.3)
      return [x + jitter, y - jitter, 0.5, i * 16]
    }),
  }
}

// Draws every guide of the lesson in order, the way a user following the steps would.
function drawLesson(transform?: Transform, wobble = 0) {
  const teacher = createTeacher(pack, pack.steps, 'guided')
  const accuracies: (number | null)[] = []
  for (const step of pack.steps) {
    for (const id of step.strokeIds) {
      const plan = pack.strokes.find((s) => s.id === id)!
      accuracies.push(teacher.addStroke(copy(plan.points, transform, wobble)).accuracy)
    }
  }
  return { teacher, accuracies }
}

const scribble = (x: number, y: number): UserStroke => ({
  points: Array.from({ length: 30 }, (_, i): TimedPoint => [x + (i % 3) * 9, y + i * 3, 0.5, i * 16]),
})

describe('real Teacher', () => {
  it('starts on the first step with full guides', () => {
    const teacher = createTeacher(pack, pack.steps, 'guided')
    const state = teacher.state()
    expect(state.currentStepId).toBe(pack.steps[0].id)
    expect(state.ghosts.length).toBeGreaterThan(0)
    expect(state.done).toBe(false)
  })

  it('completes every step when the plan is copied exactly', () => {
    const { teacher, accuracies } = drawLesson()
    const state = teacher.state()
    expect(state.done).toBe(true)
    expect(state.completedStepIds).toEqual(pack.steps.map((s) => s.id))
    // A stroke can finish a later guide it runs along (the demo head outline covers the crown), so that guide's own
    // stroke may then match nothing (null). Every stroke that did match scores high, and most strokes match.
    const matched = accuracies.filter((a): a is number => a !== null)
    expect(Math.min(...matched)).toBeGreaterThan(0.9)
    expect(matched.length).toBeGreaterThanOrEqual(accuracies.length - 2)
  })

  it('follows a drawing that is 1.2x bigger and shifted: later strokes score above 0.8', () => {
    const { teacher, accuracies } = drawLesson({ scale: 1.2, rotation: 0, tx: -60, ty: -40 })
    const later = accuracies.slice(3).map((a) => a ?? 0)
    expect(later.reduce((a, b) => a + b, 0) / later.length).toBeGreaterThan(0.8)
    expect(teacher.state().done).toBe(true)
  })

  it('moves the guides toward where the user draws', () => {
    const teacher = createTeacher(pack, pack.steps, 'guided')
    const first = pack.strokes.find((s) => s.id === pack.steps[0].strokeIds[0])!
    const shift: Transform = { scale: 1, rotation: 0, tx: 40, ty: 30 }
    // Watch the other guide of the first step (the body circle) while the user draws the head 40 px right, 30 down.
    const other = teacher.state().ghosts.find((g) => g.strokeId !== first.id)!
    const before = other.points[0]
    const after = teacher.addStroke(copy(first.points, shift)).ghosts.find((g) => g.strokeId === other.strokeId)!.points[0]
    expect(after[0] - before[0]).toBeGreaterThan(15) // moved right, toward the user's drawing
    expect(after[1] - before[1]).toBeGreaterThan(10) // and down
  })

  it('never crashes on scribbles, taps and empty strokes', () => {
    const teacher = createTeacher(pack, pack.steps, 'auto')
    expect(() => {
      teacher.addStroke({ points: [] })
      teacher.addStroke({ points: [[10, 10, 0.5, 0]] })
      for (let i = 0; i < 20; i++) teacher.addStroke(scribble(20 + i * 30, 700))
    }).not.toThrow()
    expect(teacher.state().done).toBe(false)
  })

  it('returns null accuracy (no penalty) for a stroke far from every guide', () => {
    const teacher = createTeacher(pack, pack.steps, 'guided')
    expect(teacher.addStroke(scribble(700, 700)).accuracy).toBeNull()
  })

  it('auto mode fades for a good drawer', () => {
    const { accuracies } = drawLesson()
    expect(accuracies.length).toBeGreaterThan(8)
    const teacher = createTeacher(pack, pack.steps, 'auto')
    for (const step of pack.steps) {
      for (const id of step.strokeIds) teacher.addStroke(copy(pack.strokes.find((s) => s.id === id)!.points))
    }
    const levels = teacher.history().map((c) => c.to)
    expect(levels).toContain('hints')
    expect(levels).toContain('checkin')
  })

  it('auto mode steps back up for a struggling drawer', () => {
    const teacher = createTeacher(pack, pack.steps, 'auto')
    const strokes = pack.steps.flatMap((s) => s.strokeIds).map((id) => pack.strokes.find((s) => s.id === id)!)
    // Three clean strokes earn less help...
    for (const s of strokes.slice(0, 3)) teacher.addStroke(copy(s.points))
    expect(teacher.state().helpLevel).toBe('hints')
    // ...then shaky strokes near the next guide bring it back.
    const next = strokes[3]
    for (let i = 0; i < 6; i++) teacher.addStroke(copy(next.points, { scale: 1, rotation: 0, tx: 25, ty: 0 }, 22))
    expect(teacher.history().at(-1)?.to).toBe('guided')
  })

  it('shows key points in Hints and nothing in Check-in, but Show me always shows the guides', () => {
    const teacher = createTeacher(pack, pack.steps, 'hints')
    expect(teacher.state().ghosts.every((g) => g.kind !== 'stroke')).toBe(true)
    const checkin = teacher.setMode('checkin')
    expect(checkin.ghosts).toEqual([])
    expect(teacher.showMe().length).toBeGreaterThan(0)
    expect(teacher.history().map((c) => c.to)).toEqual(['checkin'])
  })

  it('warns when a part is drawn much too big', () => {
    const teacher = createTeacher(pack, pack.steps, 'guided')
    const first = pack.strokes.find((s) => s.id === pack.steps[0].strokeIds[0])!
    const [cx, cy] = [280, 250]
    const result = teacher.addStroke(copy(first.points, { scale: 1.4, rotation: 0, tx: cx - 1.4 * cx, ty: cy - 1.4 * cy }))
    expect(result.warning).toMatch(/large/)
  })

  it('adds a stroke in under 50 ms', () => {
    const teacher = createTeacher(pack, pack.steps, 'auto')
    const plan = pack.strokes[0]
    teacher.addStroke(copy(plan.points)) // warm-up
    let worst = 0
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      teacher.addStroke(copy(plan.points, { scale: 1, rotation: 0, tx: i, ty: 0 }))
      worst = Math.max(worst, performance.now() - start)
    }
    expect(worst).toBeLessThan(50)
  })
})
