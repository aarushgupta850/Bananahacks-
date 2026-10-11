// The lesson must never get stuck. Before this fix, drawing a step's outline in one stroke, backwards or a bit
// bigger than the guide left the step unfinished forever (seen on the fish's "Outline the body").
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/fish-medium/pack.json?raw'
import { parsePack } from '../../lib/packs'
import { createTeacher } from '../real/teacher'
import type { Point, TimedPoint, UserStroke } from '../types'

const pack = parsePack(JSON.parse(packText), 'fish')
const points = (id: string) => pack.strokes.find((s) => s.id === id)!.points
const stroke = (pts: Point[], dx = 0, dy = 0, wobble = 0): UserStroke => ({
  points: pts.map(([x, y], i): TimedPoint => [x + dx + wobble * Math.sin(i * 1.7), y + dy + wobble * Math.cos(i * 1.3), 0.5, i * 16]),
})
// The fish lesson starts with the body's construction shape, then "Outline the body" (two guides).
const [first, outline] = pack.steps
const [top, bottom] = outline.strokeIds.map(points)

// A teacher that has finished the first step and now shows "Outline the body".
function onOutlineStep() {
  const teacher = createTeacher(pack, pack.steps, 'guided')
  for (const id of first.strokeIds) teacher.addStroke(stroke(points(id)))
  expect(teacher.state().currentStepId).toBe(outline.id)
  return teacher
}

describe('the lesson never gets stuck', () => {
  it('accepts the whole outline drawn in one stroke', () => {
    const teacher = onOutlineStep()
    const result = teacher.addStroke(stroke([...top, ...bottom], 4, 4, 2))
    expect(result.accuracy).toBeGreaterThan(0.6)
    expect(teacher.state().currentStepId).not.toBe(outline.id)
  })

  it('accepts the outline drawn backwards', () => {
    const teacher = onOutlineStep()
    teacher.addStroke(stroke([...top].reverse(), 5, 5, 2))
    teacher.addStroke(stroke([...bottom].reverse(), 5, 5, 2))
    expect(teacher.state().currentStepId).not.toBe(outline.id)
  })

  it('moves on after enough tries even when the strokes never fit well', () => {
    const teacher = onOutlineStep()
    // Strokes drawn 15% too big, then the same again: near the guides, but never close enough to cover them.
    const big = (pts: Point[]) => pts.map(([x, y]): Point => [384 + (x - 384) * 1.15, 384 + (y - 384) * 1.15])
    for (let i = 0; i < 6 && teacher.state().currentStepId === outline.id; i++) teacher.addStroke(stroke(big(i % 2 ? bottom : top)))
    expect(teacher.state().currentStepId).not.toBe(outline.id)
  })

  it('does not finish a step for a scribble far from its guides', () => {
    const teacher = onOutlineStep()
    for (let i = 0; i < 8; i++) {
      teacher.addStroke({ points: Array.from({ length: 30 }, (_, k): TimedPoint => [20 + (k % 3) * 9, 700 + k, 0.5, k * 16]) })
    }
    expect(teacher.state().currentStepId).toBe(outline.id)
  })
})
