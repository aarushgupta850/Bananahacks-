// Turns measurements into words and numbers for the user: the weak spots, the lesson order, the score,
// and the before/after coaching. Every message is a template filled with values measured in analyze.ts.
import type { Analysis, CoachItem, Coaching, Pack, PartMetric, Score, Step, Weakness } from '../types'
import { config } from './config'
import { clamp } from './geometry'

const percent = (n: number) => Math.round(Math.abs(n) * 100)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const offsetSize = (m: PartMetric) => Math.max(Math.abs(m.offset.dx), Math.abs(m.offset.dy))
// How far off the whole drawing's size is: 0.7 drawn = 30% too small = -0.3. An empty drawing measures 0.
const overallSizeError = (a: Analysis) => (a.alignedStrokes.length > 0 ? a.overallScale - 1 : 0)
// Proportion credit kept for the whole drawing's size: 1 within config.overallSizeTolerance, then less.
const sizeCredit = (a: Analysis) =>
  clamp(1 - config.overallSizeSlope * Math.max(0, Math.abs(overallSizeError(a)) - config.overallSizeTolerance), 0, 1)
// "Drawing size: 30% too small", or "within 5%" once it's back in range.
function overallSizeWords(error: number): string {
  if (Math.abs(error) <= config.overallSizeTolerance) return percent(error) === 0 ? 'spot on' : `within ${percent(error)}%`
  return `${percent(error)}% too ${error > 0 ? 'big' : 'small'}`
}

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
  // The whole drawing drawn too big or too small: it should be to scale with the reference.
  const size = overallSizeError(analysis)
  if (Math.abs(size) > config.overallSizeTolerance) {
    found.push({
      partId: null, kind: 'size', severity: clamp(Math.abs(size), 0, 1),
      message: `Whole drawing ${percent(size)}% too ${size > 0 ? 'big' : 'small'}: draw it to scale with the reference`,
    })
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

// Each part scores max(0, 1 - slope * (|size error| + |dx| + |dy|)), where errors within
// config.proportionTolerance are free and config.proportionSlope makes bigger ones count faster (a tail drawn
// 70% too small is nearly a forgotten tail, and scored 0.5 with a slope of 1),
// and a missing part 0. proportion mixes the mean of those with the worst one (config.proportionWorstShare),
// so one badly sized part can't hide behind the rest. A pack without parts uses the shape for proportion.
//
// Proportion and line only earn full credit once the drawing looks like the subject: both are multiplied by
// shape / config.creditFullShape (at most 1). Without this, part boxes and smooth lines scored on their own:
// 14 random straight lines got the full 25 line points ("confident lines") plus part sizes from whatever ink
// landed in each part's box, and scored 47-83. A real drawing, even a rough one, is far above the threshold,
// so this only costs drawings that don't resemble the subject (or barely started ones).
//
// total = 40 * proportion + 35 * shape + 25 * line, with the values returned here, so the report's three bars
// always add up to the total.
export function score(analysis: Analysis): Score {
  const shape = clamp(analysis.shapeSimilarity, 0, 1)
  const credit = clamp(shape / config.creditFullShape, 0, 1)
  const line = clamp(analysis.lineConfidence, 0, 1) * credit
  // Errors within config.proportionTolerance cost nothing: hand drawings are never exact.
  const over = (error: number) => Math.max(0, Math.abs(error) - config.proportionTolerance)
  const perPart = analysis.parts.map((m) => (m.missing
    ? 0
    : Math.max(0, 1 - config.proportionSlope * (over(m.sizeError) + over(m.offset.dx) + over(m.offset.dy)))))
  const mean = perPart.reduce((sum, p) => sum + p, 0) / Math.max(perPart.length, 1)
  // Times the whole drawing's size credit: drawn to scale with the reference, or it costs proportion points.
  const proportion = (perPart.length === 0
    ? shape
    : (1 - config.proportionWorstShare) * mean + config.proportionWorstShare * Math.min(...perPart)) * credit * sizeCredit(analysis)
  // Whole percents, as the report shows them, and the total made from those, so the bars and the total agree.
  const pct = (n: number) => Math.round(n * 100) / 100
  const [p, s, l] = [pct(proportion), pct(shape), pct(line)]
  const total = Math.round(config.weightProportion * p + config.weightShape * s + config.weightLine * l)
  return { total: clamp(total, 0, 100), proportion: p, shape: s, line: l }
}

// How big one weakness is in an analysis (0 = gone). Missing counts as 1; a part missing again is still 1.
function errorOf(w: Weakness, a: Analysis): number {
  if (w.kind === 'line') return 1 - a.lineConfidence
  if (w.kind === 'size' && w.partId === null) return Math.abs(overallSizeError(a))
  const m = a.parts.find((p) => p.partId === w.partId)
  if (!m || m.missing) return 1
  if (w.kind === 'missing') return 0
  if (w.kind === 'size') return Math.abs(m.sizeError)
  if (w.kind === 'position') return offsetSize(m)
  return Math.abs(m.aspectError)
}

// Words for one measure in the retest: "5% too small", "within 3%", "spot on" or "missing". The direction is said
// again because it can flip: a head 24% too big in the test can come out 20% too small in the retest, and
// "→ 20%" read as if it were still too big.
function nowWords(w: Weakness, after: PartMetric | undefined): string {
  if (!after || after.missing) return 'missing'
  const error = w.kind === 'size' ? after.sizeError : w.kind === 'position' ? offsetSize(after) : after.aspectError
  if (Math.abs(error) <= config.goodLimit) return percent(error) === 0 ? 'spot on' : `within ${percent(error)}%`
  if (w.kind === 'size') return `${percent(error)}% too ${error > 0 ? 'big' : 'small'}`
  if (w.kind === 'position') return `${percent(error)}% ${offsetWords(after)}`
  return `${percent(error)}% too ${error > 0 ? 'wide' : 'narrow'}`
}

// "Head size: 24% too big → within 5%"
function describeFix(w: Weakness, test: Analysis, retest: Analysis): string {
  const before = test.parts.find((p) => p.partId === w.partId)
  const after = retest.parts.find((p) => p.partId === w.partId)
  const name = capitalize(before?.label ?? 'part')
  if (w.kind === 'line') return `Line confidence: ${percent(test.lineConfidence)}% → ${percent(retest.lineConfidence)}%`
  if (w.kind === 'size' && w.partId === null) {
    return `Drawing size: ${overallSizeWords(overallSizeError(test))} → ${retest.alignedStrokes.length > 0 ? overallSizeWords(overallSizeError(retest)) : 'nothing drawn'}`
  }
  if (w.kind === 'missing') return `${name}: missing → ${after && !after.missing ? 'drawn' : 'still missing'}`
  const now = nowWords(w, after)
  if (w.kind === 'size') return `${name} size: ${percent(before!.sizeError)}% too ${before!.sizeError > 0 ? 'big' : 'small'} → ${now}`
  if (w.kind === 'position') return `${name} position: ${percent(offsetSize(before!))}% ${offsetWords(before!)} → ${now}`
  return `${name} shape: ${percent(before!.aspectError)}% too ${before!.aspectError > 0 ? 'wide' : 'narrow'} → ${now}`
}

// "Your ear position was spot on, within 4%", or just "spot on" when the error rounds to 0%.
function spotOn(label: string, measure: 'size' | 'position', error: number): string {
  const within = percent(error) > 0 ? `, within ${percent(error)}%` : ''
  return `Your ${label.toLowerCase()} ${measure} was spot on${within}`
}

// Whether a weakness is gone in the retest: back within the limit that made it a weakness.
function fixedIn(w: Weakness, a: Analysis): boolean {
  if (w.kind === 'line') return a.alignedStrokes.length > 0 && a.lineConfidence >= config.lineWeakBelow
  if (w.kind === 'size' && w.partId === null) return a.alignedStrokes.length > 0 && errorOf(w, a) <= config.overallSizeTolerance
  return errorOf(w, a) <= config.goodLimit
}

export function coach(_pack: Pack, test: Analysis, retest: Analysis): Coaching {
  // Fix items: the test's 3 biggest problems. One counts as improved when its retest error is at least 40%
  // smaller, or back within the limit (a part 12% too big in the test and 9% in the retest is fixed, though
  // 9 is not 40% less than 12). A part left out of the retest is never "improved".
  const missingNow = (w: Weakness) => w.partId !== null && retest.parts.some((p) => p.partId === w.partId && p.missing)
  const testWeaknesses = allWeaknesses(test).slice(0, config.maxWeaknesses)
  const fix = testWeaknesses.map((w): CoachItem => ({
    text: describeFix(w, test, retest),
    partId: w.partId,
    status: !missingNow(w) && (fixedIn(w, retest) || errorOf(w, retest) <= errorOf(w, test) * (1 - config.improvedShare))
      ? 'improved'
      : 'not-yet',
  }))
  // The retest's biggest problem that the test's list didn't have (a part left out this time, a new size
  // error), so a retest that got worse somewhere never reads as "Nothing big to fix". A part that was missing
  // in the test and is drawn now isn't "new" whatever its size: the fix item above already covers it.
  const listed = (w: Weakness) => testWeaknesses.some((t) => t.partId === w.partId && (t.kind === w.kind || t.kind === 'missing'))
  const newProblem = allWeaknesses(retest).find((w) => !listed(w))
  // (Not for an empty retest: every part is "new" there, and the report says the round was skipped.)
  if (newProblem && retest.alignedStrokes.length > 0) fix.push({ text: `New this time: ${newProblem.message}`, partId: newProblem.partId, status: 'not-yet' })

  // Good items: the retest's best parts that weren't already a fix item, by their best measure. Only for a
  // retest that looks like the subject: part boxes measured from random lines say nothing worth praising.
  const fixed = new Set(fix.map((f) => f.partId))
  const praise = retest.shapeSimilarity >= config.praiseMinShape
  const good = retest.parts
    .filter((m) => praise && !m.missing && m.good && !fixed.has(m.partId))
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
