import { describe, expect, it } from 'vitest'
import { createMockEngine } from '../mock'
import type { Analysis, Box, Ghost, Pack, Point, Step, StrokeResult, Weakness } from '../types'
import { drawing, foxPack, makeLongPack, strokeAt } from './fixtures'

// ---------- shape checks: does a value really have the shape types.ts promises? ----------

const HELP_LEVELS = ['guided', 'hints', 'checkin']
const TIERS = ['construction', 'outline', 'structure', 'detail']

function expectFinite(...values: number[]) {
  for (const n of values) expect(Number.isFinite(n)).toBe(true)
}

function expectUnit(n: number) {
  expect(n).toBeGreaterThanOrEqual(0)
  expect(n).toBeLessThanOrEqual(1)
}

function expectPoints(points: Point[]) {
  for (const p of points) {
    expect(p).toHaveLength(2)
    expectFinite(...p)
  }
}

function expectBox(box: Box) {
  expect(box).toHaveLength(4)
  expectFinite(...box)
}

function expectAnalysis(a: Analysis, pack: Pack) {
  expect(a.parts.map((m) => m.partId)).toEqual(pack.parts.map((p) => p.id))
  for (const m of a.parts) {
    expect(typeof m.label).toBe('string')
    expect(typeof m.missing).toBe('boolean')
    expect(typeof m.good).toBe('boolean')
    expectFinite(m.sizeError, m.offset.dx, m.offset.dy, m.aspectError, m.tiltDeg)
    if (m.userBox !== null) expectBox(m.userBox)
  }
  expectUnit(a.shapeSimilarity)
  expectUnit(a.lineConfidence)
  expect(a.overallScale).toBeGreaterThan(0)
  expectFinite(a.overallOffset.dx, a.overallOffset.dy)
  for (const s of a.alignedStrokes) {
    for (const p of s.points) {
      expect(p).toHaveLength(4)
      expectFinite(...p)
    }
  }
  expect(typeof a.usedFallback).toBe('boolean')
}

function expectWeakness(w: Weakness, pack: Pack) {
  expect(['size', 'position', 'shape', 'missing', 'line']).toContain(w.kind)
  if (w.partId !== null) expect(pack.parts.map((p) => p.id)).toContain(w.partId)
  expectUnit(w.severity)
  expect(w.message.length).toBeGreaterThan(0)
}

function expectSteps(steps: Step[], pack: Pack) {
  const strokeIds = pack.strokes.map((s) => s.id)
  for (const step of steps) {
    expect(typeof step.id).toBe('string')
    expect(typeof step.label).toBe('string')
    expect(typeof step.tip).toBe('string')
    expect(TIERS).toContain(step.tier)
    for (const id of step.strokeIds) expect(strokeIds).toContain(id)
  }
}

function expectGhosts(ghosts: Ghost[], pack: Pack) {
  for (const g of ghosts) {
    expect(pack.strokes.map((s) => s.id)).toContain(g.strokeId)
    expect(['stroke', 'keypoints', 'construction']).toContain(g.kind)
    expectPoints(g.points)
  }
}

function expectStrokeResult(r: StrokeResult, steps: Step[], pack: Pack) {
  const stepIds = steps.map((s) => s.id)
  if (r.accuracy !== null) expectUnit(r.accuracy)
  for (const id of r.completedStepIds) expect(stepIds).toContain(id)
  if (r.currentStepId !== null) expect(stepIds).toContain(r.currentStepId)
  expectGhosts(r.ghosts, pack)
  expect(HELP_LEVELS).toContain(r.helpLevel)
  if (r.warning !== undefined) expect(typeof r.warning).toBe('string')
  expect(typeof r.done).toBe('boolean')
}

// Runs the scripted story: a test drawing, then a different retest drawing.
function testAndRetest() {
  const engine = createMockEngine()
  const test = engine.analyze(foxPack, drawing(1))
  const retest = engine.analyze(foxPack, drawing(2))
  return { engine, test, retest }
}

const head = (a: Analysis) => a.parts.find((m) => m.partId === 'head')!

// ---------- the engine ----------

describe('mock analyze', () => {
  it('returns a well-formed Analysis', () => {
    const { test, retest } = testAndRetest()
    expectAnalysis(test, foxPack)
    expectAnalysis(retest, foxPack)
    expect(test.alignedStrokes).toHaveLength(3)
    expect(test.usedFallback).toBe(false)
  })

  it('makes the head 24% too big in the test and 5% in the retest', () => {
    const { test, retest } = testAndRetest()
    expect(head(test).sizeError).toBe(0.24)
    expect(head(test).good).toBe(false)
    expect(head(retest).sizeError).toBe(0.05)
    expect(head(retest).good).toBe(true)
  })

  it('gives the same answer when the same drawing is analyzed again', () => {
    const engine = createMockEngine()
    const first = engine.analyze(foxPack, drawing(1))
    expect(engine.analyze(foxPack, drawing(1))).toEqual(first)
    // ...and the next new drawing is still the retest
    expect(head(engine.analyze(foxPack, drawing(2))).sizeError).toBe(0.05)
  })

  it('marks every part missing when nothing was drawn', () => {
    const engine = createMockEngine()
    const empty = engine.analyze(foxPack, [])
    expectAnalysis(empty, foxPack)
    expect(empty.parts.every((m) => m.missing && m.userBox === null)).toBe(true)
    expect(engine.score(empty).total).toBe(0)
    expect(engine.findWeaknesses(foxPack, empty).every((w) => w.kind === 'missing')).toBe(true)
  })

  it('uses the fallback for a pack without parts', () => {
    const pack = { ...foxPack, parts: [] }
    const engine = createMockEngine()
    const a = engine.analyze(pack, drawing(1))
    expectAnalysis(a, pack)
    expect(a.usedFallback).toBe(true)
    expectFinite(engine.score(a).total)
  })
})

describe('mock score', () => {
  it('goes from 48 in the test to 79 in the retest', () => {
    const { engine, test, retest } = testAndRetest()
    const before = engine.score(test)
    const after = engine.score(retest)
    expect(before.total).toBe(48)
    expect(after.total).toBe(79)
    for (const s of [before, after]) {
      expectUnit(s.proportion)
      expectUnit(s.shape)
      expectUnit(s.line)
    }
  })
})

describe('mock findWeaknesses', () => {
  it('returns up to 3 weaknesses, worst first, starting with the big head', () => {
    const { engine, test } = testAndRetest()
    const weaknesses = engine.findWeaknesses(foxPack, test)
    expect(weaknesses.length).toBeGreaterThan(0)
    expect(weaknesses.length).toBeLessThanOrEqual(3)
    for (const w of weaknesses) expectWeakness(w, foxPack)
    expect(weaknesses.map((w) => w.kind)).toEqual(['size', 'line', 'position'])
    expect(weaknesses[0]).toMatchObject({ partId: 'head', message: 'Your head is 24% too big' })
    expect(weaknesses[2].message).toBe('Your body sits 12% too low')
    const severities = weaknesses.map((w) => w.severity)
    expect(severities).toEqual([...severities].sort((a, b) => b - a))
  })
})

describe('mock buildLesson', () => {
  it('keeps the pack steps in order and adds a reminder about the head', () => {
    const { engine, test } = testAndRetest()
    const steps = engine.buildLesson(foxPack, engine.findWeaknesses(foxPack, test))
    expectSteps(steps, foxPack)
    expect(steps.map((s) => s.id)).toEqual(foxPack.steps.map((s) => s.id))
    // The first step that draws the head (construction) carries the reminder, once.
    expect(steps[0].tip).toBe('Last time: Your head is 24% too big. Start light.')
    expect(steps[1].tip).toBe('Follow the curve.')
  })

  it('makes one step per tier when the pack has no steps', () => {
    const pack = { ...foxPack, steps: [] }
    const steps = createMockEngine().buildLesson(pack, [])
    expectSteps(steps, pack)
    expect(steps.map((s) => s.tier)).toEqual(['construction', 'outline', 'structure', 'detail'])
  })
})

describe('mock teacher', () => {
  const engine = createMockEngine()

  it('returns well-formed results from every method', () => {
    const steps = foxPack.steps
    const teacher = engine.createTeacher(foxPack, steps, 'auto')
    expectStrokeResult(teacher.state(), steps, foxPack)
    expectStrokeResult(teacher.addStroke(strokeAt(10, 10)), steps, foxPack)
    expectStrokeResult(teacher.setMode('hints'), steps, foxPack)
    expectGhosts(teacher.showMe(), foxPack)
    for (const change of teacher.history()) {
      expectFinite(change.atStroke)
      expect(HELP_LEVELS).toContain(change.from)
      expect(HELP_LEVELS).toContain(change.to)
    }
  })

  it('starts on the first step with full ghost strokes and no accuracy yet', () => {
    const teacher = engine.createTeacher(foxPack, foxPack.steps, 'auto')
    const start = teacher.state()
    expect(start).toMatchObject({ accuracy: null, currentStepId: 'step-construct', helpLevel: 'guided', done: false })
    expect(start.ghosts.map((g) => [g.strokeId, g.kind])).toEqual([['c1', 'stroke'], ['c2', 'stroke']])
  })

  it('advances one step per stroke and is done after the last step', () => {
    const teacher = engine.createTeacher(foxPack, foxPack.steps, 'guided')
    const results = foxPack.steps.map((_, i) => teacher.addStroke(strokeAt(i * 10, 50)))
    expect(results[0].completedStepIds).toEqual(['step-construct'])
    expect(results[0].currentStepId).toBe('step-head')
    expect(results.slice(0, -1).every((r) => !r.done)).toBe(true)
    const last = results[results.length - 1]
    expect(last).toMatchObject({ done: true, currentStepId: null, ghosts: [] })
    expect(last.completedStepIds).toEqual(foxPack.steps.map((s) => s.id))
  })

  it('gives seeded accuracies between 0.5 and 0.95, the same every time', () => {
    const run = () => {
      const teacher = engine.createTeacher(foxPack, foxPack.steps, 'auto')
      return foxPack.steps.map(() => teacher.addStroke(strokeAt(0, 0)).accuracy)
    }
    const accuracies = run()
    for (const a of accuracies) {
      expect(a).toBeGreaterThanOrEqual(0.5)
      expect(a).toBeLessThanOrEqual(0.95)
    }
    expect(run()).toEqual(accuracies)
  })

  it('in auto mode fades guided -> hints after 5 strokes and -> checkin after 10', () => {
    const pack = makeLongPack(12)
    const teacher = engine.createTeacher(pack, pack.steps, 'auto')
    const levels = pack.steps.map(() => teacher.addStroke(strokeAt(0, 0)).helpLevel)
    expect(levels.slice(0, 4)).toEqual(['guided', 'guided', 'guided', 'guided'])
    expect(levels[4]).toBe('hints')    // the 5th stroke
    expect(levels[8]).toBe('hints')
    expect(levels[9]).toBe('checkin')  // the 10th stroke
    expect(teacher.history()).toEqual([
      { atStroke: 5, from: 'guided', to: 'hints' },
      { atStroke: 10, from: 'hints', to: 'checkin' },
    ])
  })

  it('shows key points and construction shapes in hints, nothing in checkin, and everything on showMe', () => {
    const teacher = engine.createTeacher(foxPack, foxPack.steps, 'hints')
    expect(teacher.state().ghosts.map((g) => g.kind)).toEqual(['construction', 'construction'])
    teacher.addStroke(strokeAt(0, 0))
    expect(teacher.state().ghosts).toEqual([{ strokeId: 'o1', kind: 'keypoints', points: [[300, 120], [385, 195], [470, 270]] }])
    teacher.addStroke(strokeAt(0, 0))
    // o2 has no key points, so its two ends stand in for them.
    expect(teacher.state().ghosts).toEqual([{ strokeId: 'o2', kind: 'keypoints', points: [[260, 260], [520, 500]] }])

    const checkin = teacher.setMode('checkin')
    expect(checkin.ghosts).toEqual([])
    expect(teacher.showMe().map((g) => [g.strokeId, g.kind])).toEqual([['o2', 'stroke']])
    expect(teacher.history()).toEqual([{ atStroke: 2, from: 'hints', to: 'checkin' }])
  })

  it('ignores taps and never advances on state()', () => {
    const teacher = engine.createTeacher(foxPack, foxPack.steps, 'auto')
    teacher.addStroke({ points: [[5, 5, 0.5, 0]] })
    teacher.state()
    teacher.state()
    expect(teacher.state()).toMatchObject({ accuracy: null, currentStepId: 'step-construct', completedStepIds: [] })
  })

  it('answers well under the 50 ms budget', () => {
    const pack = makeLongPack(60)
    const teacher = engine.createTeacher(pack, pack.steps, 'auto')
    const start = performance.now()
    for (let i = 0; i < 60; i++) teacher.addStroke(strokeAt(i, i))
    expect((performance.now() - start) / 60).toBeLessThan(50)
  })
})

describe('mock coach', () => {
  it('marks the head and body improved, the lines not yet, and tail and ear good', () => {
    const { engine, test, retest } = testAndRetest()
    const coaching = engine.coach(foxPack, test, retest)
    for (const item of [...coaching.fix, ...coaching.good]) {
      expect(item.text.length).toBeGreaterThan(0)
      expect(['improved', 'not-yet', 'good']).toContain(item.status)
    }
    expect(coaching.fix).toEqual([
      { text: 'Head size: 24% off in the test, 5% in the retest', partId: 'head', status: 'improved' },
      { text: 'Line confidence: 50% in the test, 65% in the retest', partId: null, status: 'not-yet' },
      { text: 'Body position: 12% off in the test, 3% in the retest', partId: 'body', status: 'improved' },
    ])
    expect(coaching.good.map((g) => [g.partId, g.status])).toEqual([['tail', 'good'], ['ear', 'good']])
  })
})
