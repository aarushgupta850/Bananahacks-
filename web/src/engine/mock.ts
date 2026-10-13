// Mock engine: deterministic, plausible fake data, so every screen can be built before the real engine exists.
// It tells a scripted story: in the test the head is 24% too big, in the retest only 5%,
// and the total score goes from 48 to 79. Turn it on with ?engine=mock or VITE_ENGINE=mock.
import type {
  Analysis, Box, CoachItem, Coaching, Engine, Ghost, HelpLevel, Mode, ModeChange, Pack, Part, PartMetric,
  PlanStroke, Point, Score, Step, StrokeResult, Teacher, Tier, TimedPoint, UserStroke, Weakness,
} from './types'

const GOOD_LIMIT = 0.1         // a part is "good" when every error is within 10%
const GOOD_TILT_DEG = 10       // ...and it is tilted by at most 10 degrees
const LINE_LIMIT = 0.7         // line confidence below this is reported as a weakness
const MAX_WEAKNESSES = 3       // findWeaknesses returns at most this many
const JITTER = 0.04            // largest random error given to the parts the script doesn't mention
const HINTS_AFTER_STROKES = 5  // auto mode: guided -> hints once this many strokes are drawn
const CHECKIN_AFTER_STROKES = 10 // auto mode: hints -> checkin once this many strokes are drawn

// The two scripted drawings. "focus" is the head (or the first part), "second" is the next part.
type ProfileName = 'test' | 'retest'
interface Profile {
  focusSizeError: number
  secondOffsetDy: number
  shapeSimilarity: number
  lineConfidence: number
  overallScale: number
  overallOffset: { dx: number; dy: number }
}
const PROFILES: Record<ProfileName, Profile> = {
  test: {
    focusSizeError: 0.24, secondOffsetDy: 0.12, shapeSimilarity: 0.55, lineConfidence: 0.5,
    overallScale: 0.8, overallOffset: { dx: 0.03, dy: -0.02 },
  },
  retest: {
    focusSizeError: 0.05, secondOffsetDy: 0.03, shapeSimilarity: 0.775, lineConfidence: 0.65,
    overallScale: 0.95, overallOffset: { dx: 0.01, dy: 0.01 },
  },
}

// ---------- small helpers ----------

// Turns a string into a 32-bit number to use as a random seed (FNV-1a hash).
function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// Seeded random numbers in [0, 1) (the "mulberry32" generator). The same seed always gives
// the same sequence, which is what keeps the mock deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const round2 = (n: number) => Math.round(n * 100) / 100
const percent = (n: number) => Math.round(Math.abs(n) * 100)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const copyPoints = (points: Point[]) => points.map(([x, y]): Point => [x, y])

// The biggest of a part's size, position and shape errors. A missing part counts as 100% off.
function partError(metric: PartMetric): number {
  if (metric.missing) return 1
  return Math.max(Math.abs(metric.sizeError), offsetError(metric), Math.abs(metric.aspectError))
}

function offsetError(metric: PartMetric): number {
  return Math.max(Math.abs(metric.offset.dx), Math.abs(metric.offset.dy))
}

// The error that one kind of weakness is about (used to describe before/after changes).
function kindError(metric: PartMetric, kind: 'size' | 'position' | 'shape'): number {
  if (kind === 'size') return Math.abs(metric.sizeError)
  if (kind === 'position') return offsetError(metric)
  return Math.abs(metric.aspectError)
}

// ---------- analyze ----------

// A cheap summary of a drawing: each stroke's point count and first point.
// Two different real drawings practically never share it.
function fingerprint(strokes: UserStroke[]): string {
  return strokes.map((s) => `${s.points.length}@${s.points[0]?.slice(0, 2).join(',') ?? ''}`).join('|')
}

// The part the script makes 24% too big: the one called "head", or else the first part.
function focusIndex(pack: Pack): number {
  const index = pack.parts.findIndex((p) => p.id.toLowerCase() === 'head' || p.label.toLowerCase() === 'head')
  return index === -1 ? 0 : index
}

// Height of the whole drawing (the union of the part boxes). Offsets are fractions of it.
function drawingHeight(pack: Pack): number {
  if (pack.parts.length === 0) return pack.size
  const top = Math.min(...pack.parts.map((p) => p.box[1]))
  const bottom = Math.max(...pack.parts.map((p) => p.box[1] + p.box[3]))
  return bottom - top
}

// Where the user's version of a part would be, given its errors: scaled about its center,
// stretched by the aspect error, then shifted by the offset.
function userBoxFor(box: Box, metric: Omit<PartMetric, 'userBox'>, height: number): Box {
  const [x, y, w, h] = box
  const userW = w * (1 + metric.sizeError) * (1 + metric.aspectError)
  const userH = h * (1 + metric.sizeError)
  const centerX = x + w / 2 + metric.offset.dx * height
  const centerY = y + h / 2 + metric.offset.dy * height
  return [Math.round(centerX - userW / 2), Math.round(centerY - userH / 2), Math.round(userW), Math.round(userH)]
}

function fakePartMetric(
  packId: string, part: Part, role: 'focus' | 'second' | 'other', profile: Profile, height: number,
): PartMetric {
  // Every part gets small seeded errors; the script then overrides the one it cares about.
  const rand = mulberry32(hashString(`${packId}/${part.id}`))
  const jitter = () => round2((rand() * 2 - 1) * JITTER)
  const sizeError = role === 'focus' ? profile.focusSizeError : jitter()
  const dx = jitter()
  const dyJitter = jitter()
  const dy = role === 'second' ? profile.secondOffsetDy : dyJitter
  const aspectError = jitter()
  const tiltDeg = Math.round((rand() * 2 - 1) * 4)

  const metric = { partId: part.id, label: part.label, missing: false, sizeError, offset: { dx, dy }, aspectError, tiltDeg }
  const good = Math.max(Math.abs(sizeError), Math.abs(dx), Math.abs(dy), Math.abs(aspectError)) <= GOOD_LIMIT
    && Math.abs(tiltDeg) <= GOOD_TILT_DEG
  return { ...metric, good, userBox: userBoxFor(part.box, { ...metric, good }, height) }
}

// Nothing drawn (for example the user pressed Skip): every part is missing.
function emptyAnalysis(pack: Pack): Analysis {
  return {
    parts: pack.parts.map((part) => ({
      partId: part.id, label: part.label, missing: true, sizeError: 0, offset: { dx: 0, dy: 0 },
      aspectError: 0, tiltDeg: 0, good: false, userBox: null,
    })),
    shapeSimilarity: 0,
    lineConfidence: 0,
    overallScale: 1,
    overallOffset: { dx: 0, dy: 0 },
    alignedStrokes: [],
    usedFallback: pack.parts.length === 0,
  }
}

// ---------- weaknesses, lesson, score, coaching ----------

// Every weakness in an analysis, worst first.
function allWeaknesses(analysis: Analysis): Weakness[] {
  const found: Weakness[] = []
  for (const m of analysis.parts) {
    const name = m.label.toLowerCase()
    if (m.missing) {
      found.push({ partId: m.partId, kind: 'missing', severity: 1, message: `Your drawing is missing the ${name}` })
      continue
    }
    if (Math.abs(m.sizeError) > GOOD_LIMIT) {
      const way = m.sizeError > 0 ? 'big' : 'small'
      found.push({
        partId: m.partId, kind: 'size', severity: clamp01(Math.abs(m.sizeError)),
        message: `Your ${name} is ${percent(m.sizeError)}% too ${way}`,
      })
    }
    const offset = offsetError(m)
    if (offset > GOOD_LIMIT) {
      const { dx, dy } = m.offset
      const way = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'too low' : 'too high') : (dx > 0 ? 'too far right' : 'too far left')
      found.push({
        partId: m.partId, kind: 'position', severity: clamp01(offset),
        message: `Your ${name} sits ${percent(offset)}% ${way}`,
      })
    }
    if (Math.abs(m.aspectError) > GOOD_LIMIT) {
      const way = m.aspectError > 0 ? 'wide' : 'narrow'
      found.push({
        partId: m.partId, kind: 'shape', severity: clamp01(Math.abs(m.aspectError)),
        message: `Your ${name} is ${percent(m.aspectError)}% too ${way}`,
      })
    }
  }
  if (analysis.lineConfidence < LINE_LIMIT) {
    found.push({
      partId: null, kind: 'line', severity: round2(LINE_LIMIT - analysis.lineConfidence),
      message: 'Your lines look hesitant. Try single, confident strokes',
    })
  }
  return found.sort((a, b) => b.severity - a.severity)
}

const TIER_ORDER: Tier[] = ['construction', 'outline', 'structure', 'detail']
const TIER_LABELS: Record<Tier, string> = {
  construction: 'Construction shapes', outline: 'Outline', structure: 'Structure', detail: 'Details',
}

// Used only when a pack has no steps: one step per tier, in drawing order.
function stepsByTier(pack: Pack): Step[] {
  return TIER_ORDER
    .map((tier) => ({
      id: `tier-${tier}`, label: TIER_LABELS[tier], tip: 'Follow the ghost lines.', tier,
      strokeIds: pack.strokes.filter((s) => s.tier === tier).map((s) => s.id),
    }))
    .filter((step) => step.strokeIds.length > 0)
}

function buildLesson(pack: Pack, weaknesses: Weakness[]): Step[] {
  const steps = pack.steps.length > 0 ? pack.steps : stepsByTier(pack)
  const partOfStroke = new Map(pack.strokes.map((s) => [s.id, s.partId]))
  const mentioned = new Set<Weakness>()
  // Keep the pack's order (construction has to come first), but put a reminder on the first step
  // that draws each weak part.
  return steps.map((step) => {
    const parts = new Set(step.strokeIds.map((id) => partOfStroke.get(id)))
    const weakness = weaknesses.find((w) => w.partId !== null && parts.has(w.partId) && !mentioned.has(w))
    if (weakness) mentioned.add(weakness)
    return {
      ...step,
      strokeIds: [...step.strokeIds],
      tip: weakness ? `Last time: ${weakness.message}. ${step.tip}` : step.tip,
    }
  })
}

function score(analysis: Analysis): Score {
  // Proportion falls by 2.5 points per 1% of the worst part error (so 40% off scores 0).
  // Packs without parts have nothing to measure, so the overall shape stands in for it.
  const worst = Math.max(0, ...analysis.parts.map(partError))
  const proportion = analysis.parts.length > 0 ? clamp01(1 - 2.5 * worst) : clamp01(analysis.shapeSimilarity)
  const shape = clamp01(analysis.shapeSimilarity)
  const line = clamp01(analysis.lineConfidence)
  const total = Math.round(100 * (0.4 * proportion + 0.4 * shape + 0.2 * line))
  return { total, proportion, shape, line }
}

// "Head size: 24% off in the test, 5% in the retest"
function describeChange(w: Weakness, test: Analysis, retest: Analysis): string {
  if (w.kind === 'line') {
    return `Line confidence: ${percent(test.lineConfidence)}% in the test, ${percent(retest.lineConfidence)}% in the retest`
  }
  const before = test.parts.find((p) => p.partId === w.partId)
  const after = retest.parts.find((p) => p.partId === w.partId)
  const name = capitalize(before?.label ?? 'part')
  if (w.kind === 'missing') {
    return `${name}: missing in the test, ${after && !after.missing ? 'drawn' : 'still missing'} in the retest`
  }
  const kind = w.kind
  const off = (m: PartMetric | undefined) => (m && !m.missing ? `${percent(kindError(m, kind))}%` : 'missing')
  return `${name} ${kind}: ${off(before)} off in the test, ${off(after)} in the retest`
}

function coach(test: Analysis, retest: Analysis): Coaching {
  // A weakness from the test counts as improved when the retest no longer has it. A part left out of the
  // retest is never "improved" (its size error is gone only because there is no part to measure), like the real engine.
  const stillWeak = allWeaknesses(retest)
  const missingNow = (w: Weakness) => w.partId !== null && retest.parts.some((r) => r.partId === w.partId && r.missing)
  const fix = allWeaknesses(test).slice(0, MAX_WEAKNESSES).map((w): CoachItem => ({
    text: describeChange(w, test, retest),
    partId: w.partId,
    status: missingNow(w) || stillWeak.some((r) => r.kind === w.kind && r.partId === w.partId) ? 'not-yet' : 'improved',
  }))

  const fixedParts = new Set(fix.map((item) => item.partId))
  const good = test.parts
    .filter((m) => m.good && !fixedParts.has(m.partId) && retest.parts.find((r) => r.partId === m.partId)?.good)
    .slice(0, 2)
    .map((m): CoachItem => ({ text: `${capitalize(m.label)}: in proportion both times`, partId: m.partId, status: 'good' }))
  if (good.length < 2 && retest.shapeSimilarity >= 0.7) {
    good.push({ text: `Overall shape: ${percent(retest.shapeSimilarity)}% match in the retest`, partId: null, status: 'good' })
  }
  return { fix, good }
}

// ---------- teacher ----------

function helpLevelFor(mode: Mode, strokeCount: number): HelpLevel {
  if (mode !== 'auto') return mode
  if (strokeCount >= CHECKIN_AFTER_STROKES) return 'checkin'
  if (strokeCount >= HINTS_AFTER_STROKES) return 'hints'
  return 'guided'
}

// What to show for the current step's strokes at a help level.
function ghostsFor(strokes: PlanStroke[], level: HelpLevel): Ghost[] {
  if (level === 'checkin') return []
  return strokes.map((s): Ghost => {
    if (level === 'guided') return { strokeId: s.id, kind: 'stroke', points: copyPoints(s.points) }
    if (s.tier === 'construction') return { strokeId: s.id, kind: 'construction', points: copyPoints(s.points) }
    // Hints: just the key points. If a stroke has none, use its two ends.
    const ends = s.points.length > 0 ? [s.points[0], s.points[s.points.length - 1]] : []
    return { strokeId: s.id, kind: 'keypoints', points: copyPoints(s.keyPoints.length > 0 ? s.keyPoints : ends) }
  })
}

function createTeacher(pack: Pack, steps: Step[], startMode: Mode): Teacher {
  const strokesById = new Map(pack.strokes.map((s) => [s.id, s]))
  const rand = mulberry32(hashString(`${pack.id}/teacher`))
  let mode = startMode
  let strokeCount = 0
  let stepIndex = 0 // index of the current step; steps before it are completed
  let accuracy: number | null = null
  let helpLevel = helpLevelFor(mode, strokeCount)
  const changes: ModeChange[] = []

  function setHelpLevel(next: HelpLevel) {
    if (next === helpLevel) return
    changes.push({ atStroke: strokeCount, from: helpLevel, to: next })
    helpLevel = next
  }

  function currentStrokes(): PlanStroke[] {
    const step = steps[stepIndex]
    if (!step) return []
    return step.strokeIds.map((id) => strokesById.get(id)).filter((s): s is PlanStroke => s !== undefined)
  }

  function state(): StrokeResult {
    const done = stepIndex >= steps.length
    return {
      accuracy,
      completedStepIds: steps.slice(0, stepIndex).map((s) => s.id),
      currentStepId: done ? null : steps[stepIndex].id,
      ghosts: ghostsFor(currentStrokes(), helpLevel),
      helpLevel,
      done,
    }
  }

  return {
    addStroke(stroke) {
      if (stroke.points.length < 2) return state() // a tap, not a line: ignore it
      strokeCount++
      accuracy = round2(0.5 + rand() * 0.45) // a seeded fake accuracy between 0.5 and 0.95
      if (stepIndex < steps.length) stepIndex++ // the mock completes one step per stroke
      if (mode === 'auto') setHelpLevel(helpLevelFor(mode, strokeCount))
      // The warning belongs to this stroke only, so state() never repeats it.
      const result = state()
      return accuracy < 0.6 ? { ...result, warning: 'That line drifted from the guide. Try a slower, steadier stroke.' } : result
    },
    setMode(next) {
      mode = next
      setHelpLevel(helpLevelFor(mode, strokeCount))
      return state()
    },
    showMe() {
      return currentStrokes().map((s): Ghost => ({ strokeId: s.id, kind: 'stroke', points: copyPoints(s.points) }))
    },
    state,
    history() {
      return changes.map((c) => ({ ...c }))
    },
  }
}

// ---------- the engine ----------

// Each call makes an independent mock with its own memory (the tests use this to start fresh).
export function createMockEngine(): Engine {
  // The Engine API cannot say whether a drawing is the test or the retest, so the mock remembers, per pack,
  // which profile each drawing got. New drawings alternate test, retest, test, ... and the same drawing
  // always gets the same answer, so analyzing it twice (React StrictMode, re-renders) changes nothing.
  const memory = new Map<string, { seen: Map<string, ProfileName>; next: ProfileName }>()

  function profileFor(packId: string, strokes: UserStroke[]): Profile {
    let entry = memory.get(packId)
    if (!entry) {
      entry = { seen: new Map(), next: 'test' }
      memory.set(packId, entry)
    }
    const key = fingerprint(strokes)
    let name = entry.seen.get(key)
    if (!name) {
      name = entry.next
      entry.seen.set(key, name)
      entry.next = name === 'test' ? 'retest' : 'test'
    }
    return PROFILES[name]
  }

  return {
    analyze(pack, strokes) {
      if (strokes.every((s) => s.points.length === 0)) return emptyAnalysis(pack)
      const profile = profileFor(pack.id, strokes)
      const focus = focusIndex(pack)
      const second = pack.parts.findIndex((_part, i) => i !== focus)
      const height = drawingHeight(pack)
      return {
        parts: pack.parts.map((part, i) =>
          fakePartMetric(pack.id, part, i === focus ? 'focus' : i === second ? 'second' : 'other', profile, height)),
        shapeSimilarity: profile.shapeSimilarity,
        lineConfidence: profile.lineConfidence,
        overallScale: profile.overallScale,
        overallOffset: { ...profile.overallOffset },
        // The mock does no alignment: it hands back copies of the strokes as they were drawn.
        alignedStrokes: strokes.map((s) => ({ points: s.points.map((p) => [...p] as TimedPoint) })),
        usedFallback: pack.parts.length === 0,
      }
    },
    // The mock reads everything it needs from the analysis, so the pack is unused.
    findWeaknesses: (_pack, analysis) => allWeaknesses(analysis).slice(0, MAX_WEAKNESSES),
    buildLesson,
    createTeacher,
    score,
    coach: (_pack, test, retest) => coach(test, retest),
  }
}

export const mockEngine = createMockEngine()
