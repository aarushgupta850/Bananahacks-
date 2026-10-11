// Turns measurements into words and numbers for the user: the weak spots, the lesson order, the score,
// and the before/after coaching. Every message is a template filled with values measured in analyze.ts.
import type { Analysis, CoachItem, Coaching, Pack, PartMetric, Score, Step, Weakness } from '../types'
import { config } from './config'
import { clamp } from './geometry'

const percent = (n: number) => Math.round(Math.abs(n) * 100)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const offsetSize = (m: PartMetric) => Math.max(Math.abs(m.offset.dx), Math.abs(m.offset.dy))

// "too low", "too far right"... from the bigger of the two offsets.
function offsetWords(m: PartMetric): string {
  const { dx, dy } = m.offset
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'too low' : 'too high'
  return dx > 0 ? 'too far right' : 'too far left'
}

// Ranking order: missing parts first, then size, then position, then shape, then line quality.
const KIND_RANK: Record<Weakness['kind'], number> = { missing: 0, size: 1, position: 2, shape: 3, line: 4 }

// Every weakness the analysis shows, already in ranking order.
function allWeaknesses(analysis: Analysis): Weakness[] {
  const found: Weakness[] = []
  for (const m of analysis.parts) {
    const name = capitalize(m.label)
    if (m.missing) {
      found.push({ partId: m.partId, kind: 'missing', severity: 1, message: `Forgot the ${m.label.toLowerCase()}` })
      continue
    }
    if (Math.abs(m.sizeError) > config.goodLimit) {
      found.push({
        partId: m.partId, kind: 'size', severity: clamp(Math.abs(m.sizeError), 0, 1),
        message: `${name} ${percent(m.sizeError)}% too ${m.sizeError > 0 ? 'big' : 'small'}`,
      })
    }
    if (offsetSize(m) > config.goodLimit) {
      found.push({
        partId: m.partId, kind: 'position', severity: clamp(offsetSize(m), 0, 1),
        message: `${name} ${percent(offsetSize(m))}% ${offsetWords(m)}`,
      })
    }
    if (Math.abs(m.aspectError) > config.goodLimit) {
      found.push({
        partId: m.partId, kind: 'shape', severity: clamp(Math.abs(m.aspectError), 0, 1),
        message: `${name} ${percent(m.aspectError)}% too ${m.aspectError > 0 ? 'wide' : 'narrow'}`,
      })
    }
  }
  // An empty drawing has no lines to judge, so it gets no line weakness (only the missing parts).
  if (analysis.alignedStrokes.length > 0 && analysis.lineConfidence < config.lineWeakBelow) {
    found.push({
      partId: null, kind: 'line', severity: clamp(config.lineWeakBelow - analysis.lineConfidence, 0, 1),
      message: 'Lines look hesitant. Try single, confident strokes',
    })
  }
  return found.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.severity - a.severity)
}

export function findWeaknesses(_pack: Pack, analysis: Analysis): Weakness[] {
  return allWeaknesses(analysis).slice(0, config.maxWeaknesses)
}

// The pack's steps, with the steps that draw weak parts moved earlier. Construction steps always stay first
// (the big shapes have to be there before anything else), and the tier order is kept, so a weak part's
// outline moves ahead of other outlines, never ahead of the construction shapes.
export function buildLesson(pack: Pack, weaknesses: Weakness[]): Step[] {
  const partOf = new Map(pack.strokes.map((s) => [s.id, s.partId]))
  const tierRank = { construction: 0, outline: 1, structure: 2, detail: 3 }
  const weakRank = (step: Step) => {
    const parts = new Set(step.strokeIds.map((id) => partOf.get(id)))
    const index = weaknesses.findIndex((w) => w.partId !== null && parts.has(w.partId))
    return index === -1 ? weaknesses.length : index
  }
  // Nothing to fix: keep the pack's own step order.
  if (weaknesses.length === 0) return pack.steps.map((step) => ({ ...step, strokeIds: [...step.strokeIds] }))
  const mentioned = new Set<Weakness>()
  return pack.steps
    .map((step, order) => ({ step, order }))
    .sort((a, b) => {
      const ta = tierRank[a.step.tier]
      const tb = tierRank[b.step.tier]
      if (ta === 0 || tb === 0) return ta - tb || a.order - b.order // construction first, in pack order
      return ta - tb || weakRank(a.step) - weakRank(b.step) || a.order - b.order
    })
    .map(({ step }) => {
      // The first step that draws a weak part reminds the user what went wrong last time.
      const parts = new Set(step.strokeIds.map((id) => partOf.get(id)))
      const weakness = weaknesses.find((w) => w.partId !== null && parts.has(w.partId) && !mentioned.has(w))
      if (weakness) mentioned.add(weakness)
      return { ...step, strokeIds: [...step.strokeIds], tip: weakness ? `Last time: ${weakness.message}. ${step.tip}` : step.tip }
    })
}

// proportion = mean over parts of max(0, 1 - |size error| - |dx| - |dy|), missing parts count 0;
// total = 40 * proportion + 35 * shape + 25 * line. A pack without parts uses the shape for proportion.
export function score(analysis: Analysis): Score {
  const shape = clamp(analysis.shapeSimilarity, 0, 1)
  const line = clamp(analysis.lineConfidence, 0, 1)
  const proportion = analysis.parts.length === 0
    ? shape
    : analysis.parts.reduce((sum, m) => sum + (m.missing
      ? 0
      : Math.max(0, 1 - Math.abs(m.sizeError) - Math.abs(m.offset.dx) - Math.abs(m.offset.dy))), 0) / analysis.parts.length
  const total = Math.round(config.weightProportion * proportion + config.weightShape * shape + config.weightLine * line)
  return { total: clamp(total, 0, 100), proportion, shape, line }
}

// How big one weakness is in an analysis (0 = gone). Missing counts as 1; a part missing again is still 1.
function errorOf(w: Weakness, a: Analysis): number {
  if (w.kind === 'line') return 1 - a.lineConfidence
  const m = a.parts.find((p) => p.partId === w.partId)
  if (!m || m.missing) return 1
  if (w.kind === 'missing') return 0
  if (w.kind === 'size') return Math.abs(m.sizeError)
  if (w.kind === 'position') return offsetSize(m)
  return Math.abs(m.aspectError)
}

// "Head size: 24% too big → 5%"
function describeFix(w: Weakness, test: Analysis, retest: Analysis): string {
  const before = test.parts.find((p) => p.partId === w.partId)
  const after = retest.parts.find((p) => p.partId === w.partId)
  const name = capitalize(before?.label ?? 'part')
  if (w.kind === 'line') return `Line confidence: ${percent(test.lineConfidence)}% → ${percent(retest.lineConfidence)}%`
  if (w.kind === 'missing') return `${name}: missing → ${after && !after.missing ? 'drawn' : 'still missing'}`
  const now = after && !after.missing ? `${percent(errorOf(w, retest))}%` : 'missing'
  if (w.kind === 'size') return `${name} size: ${percent(before!.sizeError)}% too ${before!.sizeError > 0 ? 'big' : 'small'} → ${now}`
  if (w.kind === 'position') return `${name} position: ${percent(offsetSize(before!))}% ${offsetWords(before!)} → ${now}`
  return `${name} shape: ${percent(before!.aspectError)}% too ${before!.aspectError > 0 ? 'wide' : 'narrow'} → ${now}`
}

// "Your ear position was spot on, within 4%", or just "spot on" when the error rounds to 0%.
function spotOn(label: string, measure: 'size' | 'position', error: number): string {
  const within = percent(error) > 0 ? `, within ${percent(error)}%` : ''
  return `Your ${label.toLowerCase()} ${measure} was spot on${within}`
}

export function coach(_pack: Pack, test: Analysis, retest: Analysis): Coaching {
  // Fix items: the test's 3 biggest problems, improved when the retest error is at least 40% smaller.
  // A part left out of the retest is never "improved", however big its error was in the test.
  const missingNow = (w: Weakness) => w.partId !== null && retest.parts.some((p) => p.partId === w.partId && p.missing)
  const fix = allWeaknesses(test).slice(0, config.maxWeaknesses).map((w): CoachItem => ({
    text: describeFix(w, test, retest),
    partId: w.partId,
    status: !missingNow(w) && errorOf(w, retest) <= errorOf(w, test) * (1 - config.improvedShare) ? 'improved' : 'not-yet',
  }))

  // Good items: the retest's best parts that weren't already a fix item, by their best measure.
  const fixed = new Set(fix.map((f) => f.partId))
  const good = retest.parts
    .filter((m) => !m.missing && m.good && !fixed.has(m.partId))
    .map((m) => ({ m, size: Math.abs(m.sizeError), position: offsetSize(m) }))
    .sort((a, b) => Math.min(a.size, a.position) - Math.min(b.size, b.position))
    .slice(0, 2)
    .map(({ m, size, position }): CoachItem => ({
      text: spotOn(m.label, size <= position ? 'size' : 'position', Math.min(size, position)),
      partId: m.partId,
      status: 'good',
    }))
  if (good.length < 2 && retest.shapeSimilarity >= 0.7) {
    good.push({ text: `Overall shape: ${percent(retest.shapeSimilarity)}% match`, partId: null, status: 'good' })
  }
  return { fix, good }
}
