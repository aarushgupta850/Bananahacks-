// Robustness: the real engine must work for EVERY pack, the shipped ones and the ones the live server makes
// for any prompt or photo, and for every way a person draws. A simulated user draws through whole lessons
// (offset, too big or small, backwards, in pieces, several guides in one stroke, sloppy, with scribbles) in
// every assistance mode. Analysis, scoring and coaching get odd drawings too. Everything is seeded, so a
// failure always reproduces.
import { beforeAll, describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { realEngine as engine } from '../real'
import { createTeacher } from '../real/teacher'
import { config } from '../real/config'
import type {
  Analysis, Mode, Pack, Part, PlanStroke, Point, Step, StrokeResult, Teacher, Tier, TimedPoint, UserStroke,
} from '../types'

// ---------- packs ----------

// Every pack shipped in public/subjects (Vite reads them at build time; no file system access needed).
const shippedFiles = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const shipped: Pack[] = Object.entries(shippedFiles).map(([path, text]) => parsePack(JSON.parse(text as string), path))

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

const TIERS: Tier[] = ['construction', 'outline', 'structure', 'detail']

// A made-up pack like the live server could produce for an unknown prompt: random lines, arcs and loops,
// sometimes no parts, overlapping or duplicated guides, tiny ticks, single-point and zero-length strokes.
function customPack(seed: number): Pack {
  const r = rng(seed)
  const between = (lo: number, hi: number) => lo + r() * (hi - lo)
  const parts: Part[] = r() < 0.25 ? [] : Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i): Part => {
    const w = between(40, 300)
    const h = between(40, 300)
    return { id: `p${i}`, label: `Part ${i}`, box: [between(20, 740 - w), between(20, 740 - h), w, h] }
  })
  const shape = (): Point[] => {
    const kind = r()
    const cx = between(150, 620)
    const cy = between(150, 620)
    if (kind < 0.25) { // closed loop
      const rx = between(20, 200)
      const ry = between(20, 200)
      return Array.from({ length: 33 }, (_, i): Point => [cx + rx * Math.cos((i / 32) * 2 * Math.PI), cy + ry * Math.sin((i / 32) * 2 * Math.PI)])
    }
    if (kind < 0.5) { // arc
      const rad = between(30, 250)
      const a0 = between(0, 6)
      const sweep = between(0.5, 3)
      return Array.from({ length: 20 }, (_, i): Point => [cx + rad * Math.cos(a0 + (i / 19) * sweep), cy + rad * Math.sin(a0 + (i / 19) * sweep)])
    }
    if (kind < 0.85) { // polyline
      const n = 2 + Math.floor(r() * 8)
      return Array.from({ length: n }, (): Point => [between(40, 728), between(40, 728)])
    }
    if (kind < 0.92) return [[cx, cy], [cx + between(3, 12), cy + between(3, 12)]] // tiny tick
    if (kind < 0.96) return [[cx, cy]] // a single point
    return [[cx, cy], [cx, cy], [cx, cy]] // zero length
  }
  const strokes: PlanStroke[] = []
  const count = 6 + Math.floor(r() * 55)
  for (let i = 0; i < count; i++) {
    // Sometimes an exact duplicate of an earlier guide (traced images can do that).
    const points = i > 0 && r() < 0.06 ? strokes[Math.floor(r() * i)].points.map(([x, y]): Point => [x, y]) : shape()
    const ends = points.length > 0 ? [points[0], points[points.length - 1]] : []
    strokes.push({
      id: `s${i}`,
      points,
      tier: i < 2 && r() < 0.7 ? 'construction' : TIERS[1 + Math.floor(r() * 3)],
      partId: parts.length > 0 && r() < 0.8 ? parts[Math.floor(r() * parts.length)].id : null,
      keyPoints: r() < 0.3 ? [] : ends,
    })
  }
  const steps: Step[] = []
  for (let i = 0; i < strokes.length;) {
    const size = 1 + Math.floor(r() * 4)
    const ids = strokes.slice(i, i + size).map((s) => s.id)
    steps.push({ id: `step${steps.length}`, label: `Step ${steps.length + 1}`, tip: 'Go.', tier: strokes[i].tier, strokeIds: ids })
    i += size
  }
  return {
    id: `custom-${seed}`, subject: 'thing', title: 'Thing', difficulty: 'medium', size: 768,
    source: { kind: 'prompt', prompt: 'a thing' }, target: 'data:image/png;base64,', thumb: 'data:image/png;base64,',
    parts, strokes, steps, pipeline: [],
  }
}
const customs = Array.from({ length: 40 }, (_, i) => customPack(1000 + i))

// ---------- the simulated user ----------

type Style = 'exact' | 'offset' | 'scaled' | 'small' | 'backwards' | 'pieces' | 'merged' | 'sloppy'
const STYLES: Style[] = ['exact', 'offset', 'scaled', 'small', 'backwards', 'pieces', 'merged', 'sloppy']

const finite = (n: number) => Number.isFinite(n)

function checkResult(r: StrokeResult) {
  expect(r.accuracy === null || (finite(r.accuracy) && r.accuracy >= 0 && r.accuracy <= 1)).toBe(true)
  expect(['guided', 'hints', 'checkin']).toContain(r.helpLevel)
  for (const g of r.ghosts) for (const [x, y] of g.points) expect(finite(x) && finite(y)).toBe(true)
}

// Draws through a whole lesson the way a person following the guides would. The user's drawing is the plan
// drawn in their own frame (moved, scaled), so it doesn't drift with the guides. Returns what happened.
function drawLesson(pack: Pack, style: Style, mode: Mode, seed: number) {
  const r = rng(seed)
  const steps = engine.buildLesson(pack, [])
  const teacher: Teacher = createTeacher(pack, steps, mode)
  const plan = new Map(pack.strokes.map((s) => [s.id, s.points]))
  const scale = style === 'scaled' ? 1.2 : style === 'small' ? 0.8 : 1
  const shift = style === 'offset' ? [25, -18] : style === 'sloppy' ? [10, 8] : [0, 0]
  const wobble = style === 'sloppy' ? 5 : 1
  const mine = (p: Point): Point => [384 + (p[0] - 384) * scale + shift[0], 384 + (p[1] - 384) * scale + shift[1]]
  const toStroke = (pts: Point[]): UserStroke => ({
    points: pts.map((p, i): TimedPoint => {
      const [x, y] = mine(p)
      return [x + wobble * (r() * 2 - 1), y + wobble * (r() * 2 - 1), 0.5, i * 16]
    }),
  })
  // A point-dense copy, so pieces and joins look like real hand-drawn strokes.
  const dense = (pts: Point[]) => pts.flatMap((p, i) => (i === 0 ? [p] : [0.25, 0.5, 0.75, 1].map((t): Point =>
    [pts[i - 1][0] + (p[0] - pts[i - 1][0]) * t, pts[i - 1][1] + (p[1] - pts[i - 1][1]) * t])))

  const budget = steps.length * (config.stepPatience + 2) + pack.strokes.length + 10
  let strokes = 0
  let worstMs = 0
  let state = teacher.state()
  while (!state.done && strokes < budget) {
    // What the user aims at: the guides on screen, or the full guides from "Show me" when the help is faded.
    const targets = [...new Set((state.ghosts.length > 0 && state.helpLevel === 'guided' ? state.ghosts : teacher.showMe())
      .map((g) => g.strokeId))]
      .map((id) => dense(plan.get(id) ?? []))
      .filter((pts) => pts.length > 0)
    let drawn: Point[][]
    if (targets.length === 0) drawn = [[[100, 100], [140, 160]]] // nothing to aim at: draw anything
    else if (style === 'merged') drawn = [targets.flat()] // every guide of the step in one stroke
    else if (style === 'backwards') drawn = [[...targets[0]].reverse()]
    else if (style === 'pieces' && targets[0].length > 6) {
      const half = Math.floor(targets[0].length / 2)
      drawn = [targets[0].slice(0, half + 2), targets[0].slice(half - 1)]
    } else drawn = [targets[0]]
    // Now and then a scribble far from anything, which must never break the lesson.
    if (r() < 0.12) drawn.unshift([[740, 20], [750, 40], [735, 55], [752, 70]])
    for (const pts of drawn) {
      const start = performance.now()
      const result = teacher.addStroke(toStroke(pts))
      worstMs = Math.max(worstMs, performance.now() - start)
      checkResult(result)
      strokes++
    }
    state = teacher.state()
  }
  return { done: state.done, strokes, budget, worstMs, history: teacher.history() }
}

// ---------- the tests ----------

const ALL = [...shipped.map((p) => ({ name: p.id, pack: p })), ...customs.map((p) => ({ name: p.id, pack: p }))]

describe('every lesson can be finished, however the user draws', () => {
  // The first strokes ever run on cold, not yet optimized code. Warm up once so the timing below measures the
  // engine, not the JavaScript compiler.
  beforeAll(() => { drawLesson(shipped[0] ?? customs[0], 'exact', 'guided', 0) })

  it.each(ALL)('$name', ({ pack }) => {
    STYLES.forEach((style, k) => {
      const mode: Mode = (['auto', 'guided', 'hints', 'checkin'] as Mode[])[k % 4]
      const run = drawLesson(pack, style, mode, k + 1)
      expect({ style, mode, done: run.done }).toEqual({ style, mode, done: true })
      // Every stroke must be judged in under 50 ms. Other test files run at the same time and a garbage
      // collection can pause any stroke, so a slow lesson is timed once more (same seed, same strokes) and
      // the faster of the two counts.
      const worstMs = run.worstMs < 50 ? run.worstMs : Math.min(run.worstMs, drawLesson(pack, style, mode, k + 1).worstMs)
      expect(worstMs).toBeLessThan(50)
      for (const c of run.history) expect(c.atStroke).toBeGreaterThanOrEqual(0)
    })
  })
})

// Odd drawings for the analysis, scoring and coaching: nothing, a tap, a dot, scribbles, a tiny or a huge
// copy, a copy squashed into a corner, half a drawing, every stroke twice.
function oddDrawings(pack: Pack, seed: number): UserStroke[][] {
  const r = rng(seed)
  const u = (pts: Point[]): UserStroke => ({ points: pts.map(([x, y], i): TimedPoint => [x, y, 0.5, i * 16]) })
  const visible = pack.strokes.filter((s) => s.tier !== 'construction' && s.points.length > 0)
  const copy = (f: (p: Point) => Point) => visible.map((s) => u(s.points.map(f)))
  return [
    [],
    [u([[300, 300]])],
    [u([[300, 300], [300.5, 300.2]])],
    Array.from({ length: 10 }, () => u(Array.from({ length: 12 }, (): Point => [r() * 768, r() * 768]))),
    copy(([x, y]) => [384 + (x - 384) * 0.3, 384 + (y - 384) * 0.3]),
    copy(([x, y]) => [Math.min(768, Math.max(0, 384 + (x - 384) * 2)), Math.min(768, Math.max(0, 384 + (y - 384) * 2))]),
    copy(([x, y]) => [10 + x * 0.15, 10 + y * 0.15]),
    copy((p) => p).slice(0, Math.ceil(visible.length / 2)),
    [...copy((p) => p), ...copy((p) => p)],
    [u(Array.from({ length: 200 }, (_, i): Point => [384 + 300 * Math.cos(i), 384 + 300 * Math.sin(i * 1.3)]))],
  ]
}

function checkAnalysis(pack: Pack, a: Analysis) {
  for (const n of [a.shapeSimilarity, a.lineConfidence]) expect(finite(n) && n >= 0 && n <= 1).toBe(true)
  expect(finite(a.overallScale) && a.overallScale > 0).toBe(true)
  expect(finite(a.overallOffset.dx) && finite(a.overallOffset.dy)).toBe(true)
  for (const m of a.parts) {
    for (const n of [m.sizeError, m.offset.dx, m.offset.dy, m.aspectError, m.tiltDeg]) expect(finite(n)).toBe(true)
    if (m.userBox) for (const n of m.userBox) expect(finite(n)).toBe(true)
  }
  const score = engine.score(a)
  expect(Number.isInteger(score.total) && score.total >= 0 && score.total <= 100).toBe(true)
  for (const n of [score.proportion, score.shape, score.line]) expect(finite(n) && n >= 0 && n <= 1).toBe(true)
  const weak = engine.findWeaknesses(pack, a)
  expect(weak.length).toBeLessThanOrEqual(config.maxWeaknesses)
  for (const w of weak) expect(w.message).not.toMatch(/NaN|undefined|Infinity|null/)
  const steps = engine.buildLesson(pack, weak)
  expect(steps.map((s) => s.id).sort()).toEqual(pack.steps.map((s) => s.id).sort())
}

describe('analysis, scores and coaching never break', () => {
  it.each(ALL)('$name', ({ pack }) => {
    const drawings = oddDrawings(pack, 7)
    const analyses = drawings.map((d) => engine.analyze(pack, d))
    analyses.forEach((a) => checkAnalysis(pack, a))
    // Coaching for pairs of them (test -> retest), including empty ones on either side.
    for (let i = 0; i < analyses.length; i++) {
      const coaching = engine.coach(pack, analyses[i], analyses[(i + 3) % analyses.length])
      for (const item of [...coaching.fix, ...coaching.good]) expect(item.text).not.toMatch(/NaN|undefined|Infinity|null/)
    }
  })
})
