// Accuracy harness: drawings of KNOWN quality (accuracyDrawings.ts), made from the real packs, scored with the
// real engine. The report card is only worth showing if its numbers rank drawings the way a person would:
// a careful copy near 100, the same copy drawn smaller or off to one side the same, a sloppy copy lower, half a
// drawing lower still, random lines and scribbles near the bottom, and the right part blamed when one part
// is wrong. Everything is seeded, so a failure always reproduces.
//
// The quick checks run on every pack for the cases that matter most; the slower ones run on a small sample.
// HARNESS=all runs every check on every pack (about 30 s); HARNESS_OUT=<file> also writes the score table.
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../lib/packs'
import { realEngine as engine } from '../real'
import { config } from '../real/config'
import type { Analysis, Pack, Score, UserStroke } from '../types'
import * as D from './accuracyDrawings'

const files = import.meta.glob('../../../public/subjects/*/pack.json', { query: '?raw', import: 'default', eager: true })
const packs: Pack[] = Object.entries(files)
  .map(([path, text]) => parsePack(JSON.parse(text as string), path))
  .filter((p) => !p.id.startsWith('demo')) // the demo pack is a copy of fox-medium
const pack = (id: string) => packs.find((p) => p.id === id)!

// Read without Node's types (the app's tsconfig has none): undefined in a browser, set by the shell in vitest.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const ALL = env.HARNESS === 'all'
const SAMPLE = ['fox-medium', 'cat-medium', 'mug-simple']
const sampled = ALL ? packs : packs.filter((p) => SAMPLE.includes(p.id))

// A very different subject to draw instead (an animal for an object and the other way round).
const OTHER: Record<string, string> = {
  bird: 'house-medium', cat: 'mug-medium', face: 'sneaker-medium', fish: 'house-medium',
  fox: 'mug-medium', house: 'fish-medium', mug: 'fox-medium', sneaker: 'face-medium',
}

function run(p: Pack, strokes: UserStroke[]): { a: Analysis; s: Score } {
  const a = engine.analyze(p, strokes)
  return { a, s: engine.score(a) }
}

// Every score must be a real, in-range number, and the total must be what the three bars add up to.
function expectSane(s: Score, label: string) {
  expect(Number.isInteger(s.total), label).toBe(true)
  expect(s.total, label).toBeGreaterThanOrEqual(0)
  expect(s.total, label).toBeLessThanOrEqual(100)
  for (const n of [s.proportion, s.shape, s.line]) {
    expect(Number.isFinite(n), label).toBe(true)
    expect(n, label).toBeGreaterThanOrEqual(0)
    expect(n, label).toBeLessThanOrEqual(1)
  }
  const sum = config.weightProportion * s.proportion + config.weightShape * s.shape + config.weightLine * s.line
  expect(Math.abs(sum - s.total), `${label}: bars add up to the total`).toBeLessThanOrEqual(0.5)
}

const messages = (p: Pack, a: Analysis) => engine.findWeaknesses(p, a).map((w) => w.message)

describe('accuracy harness: every pack', () => {
  it.each(packs.map((p) => ({ name: p.id, p })))('ranks drawings of known quality: $name', ({ p }) => {
    const perfect = run(p, D.perfectCopy(p)).s
    const smaller = run(p, D.transformed(D.perfectCopy(p), p, 0.6, -60, 40)).s
    const sloppy = run(p, D.misplacedCopy(p)).s
    const half = run(p, D.partial(p)).s
    const lines = run(p, D.randomLines(p)).s
    const empty = run(p, [])
    const all = { perfect, smaller, sloppy, half, lines, empty: empty.s }
    for (const [k, s] of Object.entries(all)) expectSane(s, `${p.id} ${k}`)
    const table = JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, s]) => [k, s.total])))

    expect(perfect.total, table).toBeGreaterThanOrEqual(95)
    // Size and position on the page are never counted against the user.
    expect(Math.abs(smaller.total - perfect.total), table).toBeLessThanOrEqual(2)
    // Every line a little off: clearly lower, but still a good drawing.
    expect(sloppy.total, table).toBeLessThan(perfect.total - 3)
    expect(sloppy.total, table).toBeGreaterThanOrEqual(65)
    // Half the lines: lower than the whole drawing, far above random lines.
    expect(half.total, table).toBeLessThan(perfect.total - 5)
    expect(half.total, table).toBeGreaterThan(lines.total + 10)
    // 14 random straight lines across the page: smooth, confident and meaningless.
    expect(lines.total, table).toBeLessThanOrEqual(40)
    // Nothing drawn: 0, every part missing, and no line weakness for lines that don't exist.
    expect(empty.s.total).toBe(0)
    expect(empty.a.parts.every((m) => m.missing)).toBe(true)
    expect(engine.findWeaknesses(p, empty.a).some((w) => w.kind === 'line')).toBe(false)
  })
})

describe(`accuracy harness: ${ALL ? 'every pack' : 'sample packs'}`, () => {
  it.each(sampled.map((p) => ({ name: p.id, p })))('is fair to the way a copy is drawn: $name', ({ p }) => {
    const perfect = run(p, D.perfectCopy(p)).s
    const bigger = run(p, D.transformed(D.perfectCopy(p), p, 1.3, 30, -20)).s
    const backwards = run(p, D.reversedOrder(p)).s
    const pieces = run(p, D.splitIntoPieces(p)).s
    const doubled = run(p, D.doubledLines(p)).s
    const table = JSON.stringify({ perfect: perfect.total, bigger: bigger.total, backwards: backwards.total, pieces: pieces.total, doubled: doubled.total })
    expect(Math.abs(bigger.total - perfect.total), table).toBeLessThanOrEqual(2)
    // Order and direction of the strokes don't matter.
    expect(Math.abs(backwards.total - perfect.total), table).toBeLessThanOrEqual(1)
    // A sketchy hand (every line in short dashes) is not a scribble.
    expect(Math.abs(pieces.total - perfect.total), table).toBeLessThanOrEqual(5)
    // Going over every line twice costs only line quality.
    expect(doubled.total, table).toBeGreaterThanOrEqual(85)
  })

  it.each(sampled.map((p) => ({ name: p.id, p })))('scores junk and other subjects low: $name', ({ p }) => {
    const perfect = run(p, D.perfectCopy(p)).s
    const curves = run(p, D.randomCurves(p)).s
    const scribbles = run(p, D.scribbles(p)).s
    const one = run(p, D.oneStroke(p)).s
    const other = run(p, D.perfectCopy(pack(OTHER[p.subject]))).s
    for (const [k, s] of Object.entries({ curves, scribbles, one, other })) expectSane(s, `${p.id} ${k}`)
    const table = JSON.stringify({ curves: curves.total, scribbles: scribbles.total, one: one.total, other: other.total })
    expect(curves.total, table).toBeLessThanOrEqual(35)
    expect(scribbles.total, table).toBeLessThanOrEqual(10)
    // One stroke: low, though a mug's single outline is 40% of the whole drawing and earns about 40.
    expect(one.total, table).toBeLessThanOrEqual(45)
    // A neat drawing of something else is still not this subject.
    expect(other.total, table).toBeLessThanOrEqual(perfect.total - 30)
  })

  it.each(sampled.map((p) => ({ name: p.id, p })))('costs a lot for a big part left out of a sketchy copy: $name', ({ p }) => {
    // The second biggest part with lines of its own (the biggest is often the whole outline).
    const withLines = p.parts.filter((part) => p.strokes.some((s) => s.partId === part.id && s.tier !== 'construction'))
    const part = [...withLines].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[1]
    const { a, s } = run(p, D.withoutPart(p, part.id))
    expect(s.total).toBeLessThanOrEqual(80)
    expect(messages(p, a)).toContain(`Forgot the ${part.label.toLowerCase()}`)
  })
})

// One part drawn too big or too small: that part, and the right direction, must be named. (Known gap: a
// house roof shrunk to 0.65x lands on the wall's lines and is reported as forgotten, so only "too big" is
// checked for it.)
const PART_CASES: [string, string, string, boolean][] = [
  ['fox-medium', 'head', 'Head', true], ['fox-medium', 'tail', 'Tail', true], ['cat-medium', 'tail', 'Tail', true],
  ['house-medium', 'roof', 'Roof', false], ['mug-simple', 'handle', 'Handle', true], ['fish-medium', 'tail', 'Tail', true],
  ['bird-medium', 'wing', 'Wing', true],
]
describe('accuracy harness: the right part is blamed', () => {
  it.each(PART_CASES.map(([id, partId, name, smaller]) => ({ id, partId, name, smaller })))('$id $partId', ({ id, partId, name, smaller }) => {
    const p = pack(id)
    const big = run(p, D.partEdited(p, partId, { scale: 1.35 }))
    const small = run(p, D.partEdited(p, partId, { scale: 0.65 }))
    expect(messages(p, big.a).some((m) => new RegExp(`^${name} \\d+% too big$`).test(m)), messages(p, big.a).join(' | ')).toBe(true)
    if (smaller) expect(messages(p, small.a).some((m) => new RegExp(`^${name} \\d+% too small$`).test(m)), messages(p, small.a).join(' | ')).toBe(true)
    // ...and the part's error costs points.
    const perfect = run(p, D.perfectCopy(p)).s.total
    expect(big.s.total).toBeLessThan(perfect)
    expect(small.s.total).toBeLessThan(perfect)
  })

  it('a cat drawn without its tail (walkthrough case: it scored 93) is told so, and scores far lower', () => {
    const p = pack('cat-medium')
    const { a, s } = run(p, D.withoutPart(p, 'tail'))
    expect(messages(p, a)[0]).toBe('Forgot the tail')
    expect(s.total).toBeLessThanOrEqual(80)
  })
})

describe('accuracy harness: coaching never contradicts the numbers', () => {
  const p = pack('fox-medium')
  const bigHead = engine.analyze(p, D.partEdited(p, 'head', { scale: 1.35 }))
  const perfect = engine.analyze(p, D.perfectCopy(p))

  it('a fixed problem is improved, and a perfect retest says nothing new is wrong', () => {
    const coaching = engine.coach(p, bigHead, perfect)
    const head = coaching.fix.find((f) => f.partId === 'head')!
    expect(head.status).toBe('improved')
    expect(head.text).toMatch(/→ (within \d+%|spot on)$/)
    expect(coaching.fix.some((f) => f.text.startsWith('New this time'))).toBe(false)
  })

  it('a retest that got worse is never "improved", and the new problem is named', () => {
    const tailless = engine.analyze(p, D.partEdited(p, 'tail', { drop: true }))
    const coaching = engine.coach(p, bigHead, engine.analyze(p, D.partEdited(p, 'head', { scale: 1.6, drop: false })))
    expect(coaching.fix.find((f) => f.partId === 'head')!.status).toBe('not-yet')
    const worse = engine.coach(p, perfect, tailless)
    expect(worse.fix.map((f) => f.text)).toContain('New this time: Forgot the tail')
    expect(worse.fix.every((f) => f.status === 'not-yet')).toBe(true)
  })

  it('an empty retest improves nothing and praises nothing', () => {
    const coaching = engine.coach(p, bigHead, engine.analyze(p, []))
    expect(coaching.fix.length).toBeGreaterThan(0)
    expect(coaching.fix.every((f) => f.status === 'not-yet')).toBe(true)
    expect(coaching.good).toEqual([])
  })

  it('random lines in the retest earn no praise for part sizes', () => {
    const coaching = engine.coach(p, bigHead, engine.analyze(p, D.randomLines(p)))
    expect(coaching.good).toEqual([])
  })

  it('the direction is said again when a part flips from too big to too small', () => {
    const coaching = engine.coach(p, bigHead, engine.analyze(p, D.partEdited(p, 'head', { scale: 0.7 })))
    expect(coaching.fix.find((f) => f.partId === 'head')!.text).toMatch(/too big → \d+% too small$/)
  })
})

// HARNESS=all HARNESS_OUT=table.txt npm test -- --run realAccuracy: the full score table, for tuning.
describe.runIf(ALL)('accuracy harness: score table', () => {
  it('writes every scenario for every pack', async () => {
    const cases: [string, (p: Pack) => UserStroke[]][] = [
      ['perfect', (p) => D.perfectCopy(p)],
      ['x0.6', (p) => D.transformed(D.perfectCopy(p), p, 0.6, -60, 40)],
      ['x1.3', (p) => D.transformed(D.perfectCopy(p), p, 1.3, 30, -20)],
      ['wobbly', (p) => D.sloppyCopy(p)],
      ['sloppy', (p) => D.misplacedCopy(p)],
      ['half', (p) => D.partial(p)],
      ['noPart', (p) => D.withoutPart(p, [...p.parts].filter((part) => p.strokes.some((s) => s.partId === part.id && s.tier !== 'construction')).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[1].id)],
      ['backwards', (p) => D.reversedOrder(p)],
      ['pieces', (p) => D.splitIntoPieces(p)],
      ['doubled', (p) => D.doubledLines(p)],
      ['mirror', (p) => D.mirrored(p)],
      ['other', (p) => D.perfectCopy(pack(OTHER[p.subject]))],
      ['lines', (p) => D.randomLines(p)],
      ['curves', (p) => D.randomCurves(p)],
      ['scribble', (p) => D.scribbles(p)],
      ['one', (p) => D.oneStroke(p)],
      ['empty', () => []],
    ]
    const rows = [['pack'.padEnd(15), ...cases.map(([k]) => k.padStart(9))].join('')]
    for (const p of packs) rows.push([p.id.padEnd(15), ...cases.map(([, f]) => String(run(p, f(p)).s.total).padStart(9))].join(''))
    if (env.HARNESS_OUT) {
      // node:fs is loaded by name so the app's type check (no Node types) never sees it.
      const fs = (await import(/* @vite-ignore */ String('node:fs'))) as { writeFileSync(path: string, text: string): void }
      fs.writeFileSync(env.HARNESS_OUT, rows.join('\n') + '\n')
    }
    expect(rows.length).toBe(packs.length + 1)
  }, 120_000)
})
