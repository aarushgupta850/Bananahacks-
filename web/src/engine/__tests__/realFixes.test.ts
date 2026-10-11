// Regression tests for the bugs the pre-merge review found in the real engine. Each test is a path a user
// can really take: an ellipse started anywhere, a long outline drawn in pieces, a pipeline pack whose lines
// mostly belong to no part, a test that leaves a part out, a drawing that isn't finished, a stray tap.
import { describe, expect, it } from 'vitest'
import packText from '../../../public/subjects/demo-fox-medium/pack.json?raw'
import foxText from '../../../public/subjects/fox-medium/pack.json?raw'
import careful from './fixtures/fox-medium--careful--aarush.json'
import { parsePack } from '../../lib/packs'
import { analyze } from '../real/analyze'
import { coach, findWeaknesses } from '../real/lesson'
import { createTeacher } from '../real/teacher'
import type { Pack, PlanStroke, Point, TimedPoint, UserStroke } from '../types'

const demo = parsePack(JSON.parse(packText), 'demo pack')
const visible = (pack: Pack) => pack.strokes.filter((s) => s.tier !== 'construction')
const toUser = (points: Point[]): UserStroke => ({ points: points.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })
const copyOf = (strokes: PlanStroke[]) => strokes.map((s) => toUser(s.points))

// An ellipse as a closed polyline that starts at `startDeg` (0 = 12 o'clock) and runs clockwise or not.
function ellipse(cx: number, cy: number, rx: number, ry: number, startDeg: number, clockwise = true, n = 60): Point[] {
  return Array.from({ length: n + 1 }, (_, i): Point => {
    const a = ((startDeg + (clockwise ? 1 : -1) * (360 * i) / n) * Math.PI) / 180
    return [cx + rx * Math.sin(a), cy - ry * Math.cos(a)]
  })
}

// A small pack like the pipeline makes: a construction ellipse, two parts, and lines that belong to no part.
function pipelineLikePack(): Pack {
  const stroke = (id: string, points: Point[], partId: string | null, tier: PlanStroke['tier'] = 'outline'): PlanStroke =>
    ({ id, points, partId, tier, keyPoints: [points[0], points[points.length - 1]] })
  const strokes: PlanStroke[] = [
    stroke('c-head', ellipse(300, 200, 90, 80, 0), 'head', 'construction'),
    stroke('s-head', ellipse(300, 200, 90, 80, 0), 'head'),
    stroke('s-body', ellipse(330, 420, 140, 110, 0), 'body'),
    stroke('s-ear', [[230, 140], [215, 60], [270, 125]], null, 'structure'),          // an ear, no part
    stroke('s-leg-a', [[260, 520], [255, 640]], null, 'structure'),                   // legs and a tail, no part
    stroke('s-leg-b', [[400, 520], [405, 640]], null, 'structure'),
    stroke('s-tail', [[465, 430], [560, 380], [620, 300], [640, 220]], null, 'structure'),
  ]
  return {
    ...demo, id: 'test-medium', subject: 'test', strokes,
    parts: [{ id: 'head', label: 'Head', box: [200, 110, 200, 180] }, { id: 'body', label: 'Body', box: [180, 300, 300, 240] }],
    steps: [
      { id: 'step-1', label: 'Block in the head', tier: 'construction', strokeIds: ['c-head'], tip: '' },
      { id: 'step-2', label: 'Outline', tier: 'outline', strokeIds: ['s-head', 's-body'], tip: '' },
      { id: 'step-3', label: 'Inner lines', tier: 'structure', strokeIds: ['s-ear', 's-leg-a', 's-leg-b', 's-tail'], tip: '' },
    ],
  }
}

describe('real engine fixes', () => {
  it('accepts a construction ellipse started anywhere, drawn either way round', () => {
    const c = demo.strokes.find((s) => s.id === 'c-head')!
    const xs = c.points.map((p) => p[0])
    const ys = c.points.map((p) => p[1])
    const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    const [rx, ry] = [(Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2]
    for (const start of [0, 45, 90, 180, 270]) {
      for (const clockwise of [true, false]) {
        const teacher = createTeacher(demo, demo.steps, 'guided')
        const result = teacher.addStroke(toUser(ellipse(cx, cy, rx, ry, start, clockwise)))
        expect(result.accuracy, `start ${start}, clockwise ${clockwise}`).toBeGreaterThan(0.8)
        expect(result.ghosts.map((g) => g.strokeId), `start ${start}`).not.toContain('c-head')
      }
    }
  })

  it('completes a long outline drawn in two halves', () => {
    const teacher = createTeacher(demo, demo.steps, 'guided')
    for (const id of ['c-head', 'c-body']) teacher.addStroke(toUser(demo.strokes.find((s) => s.id === id)!.points))
    const step = demo.steps.find((s) => s.id === teacher.state().currentStepId)!
    const outline = demo.strokes.find((s) => s.id === step.strokeIds[0])!.points
    const half = Math.floor(outline.length / 2)
    const first = teacher.addStroke(toUser(outline.slice(0, half + 1)))
    expect(first.accuracy).toBeGreaterThan(0.8)
    expect(first.ghosts.map((g) => g.strokeId)).toContain(step.strokeIds[0]) // half drawn: still shown
    const second = teacher.addStroke(toUser(outline.slice(half)))
    expect(second.accuracy).toBeGreaterThan(0.8)
    expect(second.ghosts.map((g) => g.strokeId)).not.toContain(step.strokeIds[0])
  })

  it('finds a perfect copy of a pack with no-part lines good in every part', () => {
    const pack = pipelineLikePack()
    const a = analyze(pack, copyOf(visible(pack)))
    expect(a.parts.map((p) => [p.partId, p.good])).toEqual([['head', true], ['body', true]])
    expect(findWeaknesses(pack, a)).toEqual([])
  })

  it('shows a perfect copy with "your" box on top of the target box', () => {
    const a = analyze(demo, copyOf(visible(demo)))
    for (const part of demo.parts) {
      const box = a.parts.find((p) => p.partId === part.id)!.userBox!
      box.forEach((v, i) => expect(Math.abs(v - part.box[i]), `${part.id} [${i}]`).toBeLessThanOrEqual(2))
    }
  })

  it('does not call the other parts too big when one part is left out', () => {
    const a = analyze(demo, copyOf(visible(demo).filter((s) => s.partId !== 'tail')))
    expect(a.parts.find((p) => p.partId === 'tail')!.missing).toBe(true)
    for (const p of a.parts.filter((m) => m.partId !== 'tail')) {
      expect(Math.abs(p.sizeError), p.partId).toBeLessThan(0.05)
      expect(p.good, p.partId).toBe(true)
    }
    expect(findWeaknesses(demo, a).map((w) => w.message)).toEqual(['Forgot the tail'])
  })

  it('keeps an unfinished drawing where it was drawn instead of stretching it over the target', () => {
    for (const keep of [['head'], ['head', 'ears'], ['head', 'ears', 'eyes']]) {
      const a = analyze(demo, copyOf(visible(demo).filter((s) => keep.includes(s.partId ?? ''))))
      expect(a.overallScale, keep.join('+')).toBeCloseTo(1, 1)
      for (const id of keep) expect(a.parts.find((p) => p.partId === id)!.good, `${keep.join('+')}: ${id}`).toBe(true)
    }
  })

  it('ignores taps: a zero-length stroke scores like an empty drawing', () => {
    const tap: UserStroke = { points: [[300, 300, 0.5, 0], [300, 300, 0.5, 16]] }
    const a = analyze(demo, [tap])
    expect(a.alignedStrokes).toEqual([])
    expect(a.parts.every((p) => p.missing)).toBe(true)
    const teacher = createTeacher(demo, demo.steps, 'guided')
    expect(teacher.addStroke(tap).accuracy).toBeNull()
  })

  it('gives an empty test no line weakness, and never calls a part left out of the retest improved', () => {
    const empty = analyze(demo, [])
    expect(findWeaknesses(demo, empty).every((w) => w.kind === 'missing')).toBe(true)
    const test = analyze(demo, copyOf(visible(demo)))
    const badEyes = { ...test, parts: test.parts.map((p) => (p.partId === 'eyes' ? { ...p, aspectError: 2, good: false } : p)) }
    const retest = analyze(demo, copyOf(visible(demo).filter((s) => s.partId !== 'eyes')))
    const item = coach(demo, badEyes, retest).fix.find((f) => f.partId === 'eyes')!
    expect(item.status).toBe('not-yet')
  })

  it('finds eyes drawn inside a head that is bigger and lower than the target', () => {
    // Head and eyes scaled 1.3x about a point below the head, so the eyes land on the target's nose lines.
    const grow = ([x, y]: Point): Point => [280 + (x - 280) * 1.3, 330 + (y - 330) * 1.3]
    const strokes = visible(demo).map((s) => toUser(s.partId === 'head' || s.partId === 'eyes' ? s.points.map(grow) : s.points))
    const eyes = analyze(demo, strokes).parts.find((p) => p.partId === 'eyes')!
    expect(eyes.missing).toBe(false)
    expect(Math.abs(eyes.offset.dx) + Math.abs(eyes.offset.dy)).toBeLessThan(0.1) // right where they belong in the head
  })

  it("finds the eyes in Aarush's careful fox, without a made-up eye size", () => {
    const fox = parsePack(JSON.parse(foxText), 'fox-medium')
    const a = analyze(fox, (careful as { strokes: UserStroke[] }).strokes)
    const eyes = a.parts.find((p) => p.partId === 'eyes')!
    expect(eyes.missing).toBe(false)
    expect(eyes.sizeError).toBe(0) // fox-medium's plan has one eye stroke, so eye size isn't judged
    expect(findWeaknesses(fox, a).some((w) => w.partId === 'eyes')).toBe(false)
  })

  it('finds nothing to fix in a perfect copy of any shipped pack', () => {
    const packFiles = import.meta.glob<string>('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
    for (const [path, text] of Object.entries(packFiles)) {
      const pack = parsePack(JSON.parse(text), path)
      const a = analyze(pack, copyOf(visible(pack)))
      expect(findWeaknesses(pack, a).map((w) => w.message), pack.id).toEqual([])
    }
  })
})
