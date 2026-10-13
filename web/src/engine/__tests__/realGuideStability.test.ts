// Guide stability: once the first strokes have calibrated the guides, the ghost lines and the faint trace of the
// drawing must stay put, like a printed shadow. A simulated user (seeded, so every run is the same) draws whole
// lessons on real packs the way people really draw: shifted or scaled, wobbly, with a few bad strokes, a few
// strokes in the wrong place, mode switches, "Show me" and "Skip step". After every stroke the test measures
// how far the guides moved (the same movement the Teach screen applies to the trace).
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { skipStep } from '../../screens/skipStep'
import { traceMovement, IDENTITY as NO_MOVE, type Similarity } from '../../screens/trace'
import { realEngine as engine } from '../real'
import type { Ghost, Mode, Pack, Point, TimedPoint, UserStroke } from '../types'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs = new Map(Object.entries(files).map(([path, text]) => {
  const pack = parsePack(JSON.parse(text as string), path)
  return [pack.id, pack]
}))
const PACK_IDS = ['cat-medium', 'fox-medium', 'house-medium', 'face-medium']

// Seeded random numbers (mulberry32), so every run is the same.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Scenario {
  name: string
  scale: number            // the user's drawing is this much bigger than the reference (about the canvas centre)
  shift: [number, number]  // ...and sits this far off (px)
  wobble: number           // px of hand shake per point
  handError: number        // px: each stroke as a whole lands up to this far off where the user meant it
  badEvery: number         // every n-th stroke is a bad one (very shaky, 0 = none)
  wrongEvery: number       // every n-th stroke is drawn in the wrong place (0 = none)
  extras: boolean          // mode switches, Show me and Skip step along the way
}

const SCENARIOS: Scenario[] = [
  { name: 'careful copy', scale: 1, shift: [0, 0], wobble: 1.5, handError: 3, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'natural hand', scale: 1, shift: [0, 0], wobble: 3, handError: 8, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'a little off', scale: 1, shift: [9, -7], wobble: 3, handError: 6, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'offset drawing', scale: 1, shift: [45, -30], wobble: 3, handError: 6, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'bigger + offset', scale: 1.18, shift: [-20, 25], wobble: 3, handError: 6, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'smaller', scale: 0.85, shift: [0, 0], wobble: 2, handError: 5, badEvery: 0, wrongEvery: 0, extras: false },
  { name: 'bad strokes', scale: 1, shift: [0, 0], wobble: 3, handError: 8, badEvery: 4, wrongEvery: 0, extras: false },
  { name: 'wrong place', scale: 1, shift: [40, 30], wobble: 3, handError: 6, badEvery: 0, wrongEvery: 5, extras: false },
  { name: 'everything', scale: 1.1, shift: [30, -20], wobble: 4, handError: 10, badEvery: 6, wrongEvery: 7, extras: true },
]

// How far the guides moved between two movements: the largest move of any corner of the drawing's box (px),
// plus the change in size (ratio) and turn (degrees).
function moveBetween(m1: Similarity, m2: Similarity, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box
  const apply = (m: Similarity, [x, y]: Point): Point => [m.a * x - m.b * y + m.tx, m.b * x + m.a * y + m.ty]
  const corners: Point[] = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]
  const px = Math.max(...corners.map((c) => {
    const [ax, ay] = apply(m1, c)
    const [bx, by] = apply(m2, c)
    return Math.hypot(ax - bx, ay - by)
  }))
  const scale = Math.abs(Math.hypot(m2.a, m2.b) / Math.hypot(m1.a, m1.b) - 1)
  const turn = Math.abs(Math.atan2(m2.b, m2.a) - Math.atan2(m1.b, m1.a)) * (180 / Math.PI)
  return { px, scale, turn }
}

// The largest distance any ghost point moved between two sets of ghosts (same line, same kind, same points).
function ghostMove(before: Ghost[], after: Ghost[]): number {
  const old = new Map(before.map((g) => [`${g.strokeId}-${g.kind}`, g.points]))
  let worst = 0
  for (const g of after) {
    const pts = old.get(`${g.strokeId}-${g.kind}`)
    if (!pts || pts.length !== g.points.length) continue
    for (let i = 0; i < pts.length; i++) worst = Math.max(worst, Math.hypot(pts[i][0] - g.points[i][0], pts[i][1] - g.points[i][1]))
  }
  return worst
}

export interface Run {
  strokes: number
  done: boolean
  moves: { stroke: number; px: number; scale: number; turn: number; event: string }[] // every frame change
  ghostJumps: { stroke: number; px: number }[] // the largest move of a ghost that stayed on screen, per event
  traceAtEnd: number         // px between the trace frame just before the end and once the lesson is done
}

// Draws a whole lesson. The user draws in their own frame (scale + shift), aiming at the guides the teacher
// shows; the trace follows the guides exactly as on the Teach screen (traceMovement).
export function simulate(pack: Pack, s: Scenario, seed: number, mode: Mode = 'auto'): Run {
  const r = rng(seed)
  const steps = engine.buildLesson(pack, [])
  const teacher = engine.createTeacher(pack, steps, mode)
  const plan = new Map(pack.strokes.map((p) => [p.id, p.points]))
  const all = pack.strokes.flatMap((p) => p.points)
  const box: [number, number, number, number] = [
    Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])),
  ]
  const mine = ([x, y]: Point): Point => [384 + (x - 384) * s.scale + s.shift[0], 384 + (y - 384) * s.scale + s.shift[1]]
  const toStroke = (pts: Point[], wobble: number, offset: [number, number]): UserStroke => ({
    points: pts.map((p, i): TimedPoint => [
      p[0] + offset[0] + wobble * (r() * 2 - 1), p[1] + offset[1] + wobble * (r() * 2 - 1), 0.5, i * 16,
    ]),
  })
  // A point-dense copy, like a real hand-drawn stroke.
  const dense = (pts: Point[]) => pts.flatMap((p, i) => (i === 0 ? [p] : [0.25, 0.5, 0.75, 1].map((t): Point =>
    [pts[i - 1][0] + (p[0] - pts[i - 1][0]) * t, pts[i - 1][1] + (p[1] - pts[i - 1][1]) * t])))

  let state = teacher.state()
  let trace = traceMovement(teacher.showMe(), plan, NO_MOVE, state.done)
  let ghosts = state.ghosts
  const run: Run = { strokes: 0, done: false, moves: [], ghostJumps: [], traceAtEnd: 0 }
  const note = (event: string) => {
    const next = traceMovement(teacher.showMe(), plan, trace, state.done)
    const m = moveBetween(trace, next, box)
    if (m.px > 0.01 || m.scale > 1e-4 || m.turn > 1e-3) run.moves.push({ stroke: run.strokes, event, ...m })
    if (state.done && event !== 'end') run.traceAtEnd = Math.max(run.traceAtEnd, m.px)
    run.ghostJumps.push({ stroke: run.strokes, px: ghostMove(ghosts, state.ghosts) })
    ghosts = state.ghosts
    trace = next
  }
  const budget = steps.length * 10 + 20
  let currentMode = mode
  while (!state.done && run.strokes < budget) {
    const n = run.strokes + 1
    if (s.extras && n % 9 === 0) { // switch modes now and then
      currentMode = (['guided', 'hints', 'auto', 'checkin'] as Mode[])[(n / 9) % 4]
      state = teacher.setMode(currentMode)
      note('mode')
    }
    if (s.extras && n % 11 === 0) { teacher.showMe(); note('show me') }
    if (s.extras && n % 13 === 0) {
      state = skipStep(teacher, steps, currentMode).result
      note('skip')
      if (state.done) break
    }
    const target = (state.ghosts.length > 0 && state.helpLevel === 'guided' ? state.ghosts : teacher.showMe())[0]
    const points = dense(plan.get(target?.strokeId ?? '') ?? [[100, 100], [160, 140]])
    const offset: [number, number] = [s.handError * (r() * 2 - 1), s.handError * (r() * 2 - 1)]
    let stroke: UserStroke
    if (s.wrongEvery && n % s.wrongEvery === 0) {
      // In the wrong place: the line drawn where it is in the reference, not where this user's drawing is.
      stroke = toStroke(points, s.wobble, offset)
    } else if (s.badEvery && n % s.badEvery === 0) {
      stroke = toStroke(points.map(mine), 18, [offset[0] * 2, offset[1] * 2]) // very shaky and off
    } else {
      stroke = toStroke(points.map(mine), s.wobble, offset)
    }
    state = teacher.addStroke(stroke)
    run.strokes++
    note('stroke')
  }
  run.done = state.done
  return run
}

const CALIBRATION = 3 // strokes allowed to settle the guides

describe('guides stay put once calibrated', () => {
  it('finds the packs', () => {
    for (const id of PACK_IDS) expect(packs.has(id)).toBe(true)
  })

  const cases = PACK_IDS.flatMap((id) => SCENARIOS.map((s, k) => ({ name: `${id}: ${s.name}`, id, s, seed: 7 + k })))
  const report: string[] = []

  it.each(cases)('$name', ({ id, s, seed }) => {
    const run = simulate(packs.get(id)!, s, seed)
    const late = run.moves.filter((m) => m.stroke > CALIBRATION)
    const worstLate = Math.max(0, ...late.map((m) => m.px))
    const worstGhost = Math.max(0, ...run.ghostJumps.filter((j) => j.stroke > CALIBRATION).map((j) => j.px))
    report.push(`${id.padEnd(13)} ${s.name.padEnd(16)} strokes ${String(run.strokes).padStart(3)} moves ${run.moves.length} ` +
      `(after calibration ${late.length}, worst ${worstLate.toFixed(1)} px) ghost jump ${worstGhost.toFixed(1)} px ` +
      `trace at end ${run.traceAtEnd.toFixed(1)} px`)
    // Set STABILITY_REPORT=1 (and --disableConsoleIntercept) to print every run.
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.STABILITY_REPORT) console.log(report.at(-1), JSON.stringify(run.moves.map((m) => [m.stroke, m.event, +m.px.toFixed(1)])))
    expect(run.done).toBe(true)
    // Calibration moves the guides at most twice, all within the first strokes.
    expect(run.moves.length).toBeLessThanOrEqual(2)
    // After calibration nothing moves more than 2 px, whatever the user does (wrong place, bad strokes,
    // mode switches, Show me, Skip step).
    expect(worstLate).toBeLessThanOrEqual(2)
    expect(worstGhost).toBeLessThanOrEqual(2)
    // The trace stays where the guides were when the lesson ends (it used to snap back to the reference).
    expect(run.traceAtEnd).toBeLessThanOrEqual(2)
  })
})
