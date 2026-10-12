// The lesson's stroke grading must be honest. Before these fixes, on the real fox lesson:
// - a sloppy trace (wobbling 10 px off the line) scored 90-96%, nearly the same as a careful one;
// - a careless last piece of a line drawn in pieces showed the line's average (94%), not its own score;
// - going over a line finished earlier showed "0% match" (it was judged against the current guide);
// - short strokes drawn a few pixels past their ends warned "The legs is getting large";
// - a step with four guides was cut short after six strokes, even while each stroke was finishing a guide.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/fox-medium/pack.json?raw'
import { parsePack } from '../../lib/packs'
import { realEngine } from '../real'
import { length, resample } from '../real/geometry'
import { matchStroke } from '../real/match'
import { createTeacher, planDiagonal } from '../real/teacher'
import type { Point, TimedPoint, UserStroke } from '../types'

const pack = parsePack(JSON.parse(packText), 'fox-medium')
const steps = realEngine.buildLesson(pack, [])
const plan = (id: string) => pack.strokes.find((s) => s.id === id)!.points

// A hand-like trace: the line moved by (dx, dy), with a smooth sideways wobble of `wobble` px.
function trace(points: Point[], wobble = 0, dx = 0, dy = 0): UserStroke {
  const even = resample(points, Math.max(8, Math.round(length(points) / 5)))
  return {
    points: even.map(([x, y], i): TimedPoint => {
      const [ax, ay] = even[Math.max(0, i - 1)]
      const [bx, by] = even[Math.min(even.length - 1, i + 1)]
      const norm = Math.hypot(bx - ax, by - ay) || 1
      const off = wobble * Math.sin(i * 0.35)
      return [x - ((by - ay) / norm) * off + dx, y + ((bx - ax) / norm) * off + dy, 0.5, i * 16]
    }),
  }
}

// A teacher with the first `n` steps drawn exactly.
function after(n: number) {
  const teacher = createTeacher(pack, steps, 'guided')
  for (const step of steps.slice(0, n)) for (const id of step.strokeIds) teacher.addStroke(trace(plan(id)))
  return teacher
}

describe('lesson grading', () => {
  it('tells a careful trace from a sloppy one, and a stroke far off scores low', () => {
    const head = plan(steps[0].strokeIds[0]) // "Block in the head": a big construction circle
    const score = (stroke: UserStroke) => createTeacher(pack, steps, 'guided').addStroke(stroke).accuracy!
    const careful = score(trace(head, 2, 1, 1))
    const sloppy = score(trace(head, 10, 8, 6))
    const farOff = score(trace(head, 2, 40, 0))
    expect(careful).toBeGreaterThan(0.9)
    expect(sloppy).toBeLessThan(0.85)
    expect(careful - sloppy).toBeGreaterThan(0.1)
    expect(farOff).toBeLessThan(0.5)
  })

  it('holds a short guide to a stricter standard than a long one', () => {
    // The same 12 px slip is close on a long outline and wrong on a short detail line.
    const slip = (id: string) => {
      const pts = plan(id)
      return matchStroke(pts.map(([x, y]): Point => [x + 12, y]), [{ id, points: pts }], planDiagonal(pack))!.accuracy
    }
    const long = steps[1].strokeIds[0] // "Block in the body"
    const short = steps[steps.length - 1].strokeIds[0] // a 33 px detail line
    expect(length(plan(short))).toBeLessThan(60)
    expect(slip(short)).toBeLessThan(slip(long) - 0.15)
  })

  it('shows a careless last piece of a line as careless', () => {
    const teacher = after(3)
    const guide = resample(teacher.showMe()[0].points, 90)
    expect(teacher.addStroke(trace(guide.slice(0, 40), 1)).accuracy).toBeGreaterThan(0.85)
    expect(teacher.addStroke(trace(guide.slice(39, 70), 1)).accuracy).toBeGreaterThan(0.85)
    const careless = teacher.addStroke(trace(guide.slice(69), 6, 0, 25)).accuracy
    expect(careless).not.toBeNull()
    expect(careless!).toBeLessThan(0.75)
  })

  it('scores a redraw of a finished line against that line, and moves nothing', () => {
    const teacher = after(4)
    const before = teacher.state()
    const guidesBefore = teacher.showMe()
    for (const id of steps.slice(0, 4).flatMap((s) => s.strokeIds)) {
      const result = teacher.addStroke(trace(plan(id), 1, 1, 1))
      expect(result.accuracy, id).toBeGreaterThan(0.8)
      expect(result.warning, id).toBeUndefined()
      expect(result.currentStepId, id).toBe(before.currentStepId)
    }
    expect(teacher.showMe()).toEqual(guidesBefore) // the current guides didn't move
  })

  it('does not warn about the size of short strokes drawn a little past their ends', () => {
    // The first step of short lines that belong to a part (the fox's toes), where the old check warned.
    const at = steps.findIndex((step) => step.strokeIds.every((id) => {
      const s = pack.strokes.find((x) => x.id === id)!
      return s.partId !== null && length(s.points) < 60
    }))
    expect(at).toBeGreaterThan(-1)
    const teacher = after(at)
    for (const id of steps[at].strokeIds) {
      const pts = plan(id)
      const [a, b] = [pts[0], pts[pts.length - 1]]
      const unit = (p: Point, q: Point): Point => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [(p[0] - q[0]) / d, (p[1] - q[1]) / d] }
      const [ua, ub] = [unit(a, pts[1]), unit(b, pts[pts.length - 2])]
      const longer: Point[] = [[a[0] + 5 * ua[0], a[1] + 5 * ua[1]], ...pts, [b[0] + 5 * ub[0], b[1] + 5 * ub[1]]]
      expect(teacher.addStroke(trace(longer)).warning, id).toBeUndefined()
    }
  })

  it('warns in plain English, plural parts included', () => {
    const legs = { ...pack, parts: pack.parts.map((p) => ({ ...p, label: 'Legs' })) }
    const teacher = createTeacher(legs, steps, 'guided')
    const head = plan(steps[0].strokeIds[0])
    const [cx, cy] = [head.reduce((s, p) => s + p[0], 0) / head.length, head.reduce((s, p) => s + p[1], 0) / head.length]
    const big = head.map(([x, y]): Point => [cx + (x - cx) * 1.4, cy + (y - cy) * 1.4])
    expect(teacher.addStroke(trace(big)).warning).toBe('The legs are getting large. Try keeping them closer to the guide.')
  })

  it('lets a step with four guides finish at the user\'s pace when every few strokes finish a guide', () => {
    const at = steps.findIndex((s) => s.strokeIds.length === 4)
    expect(at).toBeGreaterThan(-1)
    const teacher = after(at)
    const [g1, g2, g3, g4] = steps[at].strokeIds
    // Each of the first three guides in two pieces: six strokes, three guides finished, one still to draw.
    for (const id of [g1, g2, g3]) {
      const pts = resample(plan(id), 40)
      teacher.addStroke(trace(pts.slice(0, 21)))
      teacher.addStroke(trace(pts.slice(19)))
    }
    expect(teacher.state().currentStepId).toBe(steps[at].id)
    expect(teacher.showMe().map((g) => g.strokeId)).toEqual([g4]) // not finished for the user
    teacher.addStroke(trace(plan(g4)))
    expect(teacher.state().currentStepId).not.toBe(steps[at].id)
  })
})
