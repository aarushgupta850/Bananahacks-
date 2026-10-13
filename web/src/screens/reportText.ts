// Pure helpers that turn engine results into the report card's sentences. Every number comes from the engine;
// these only put it into words. Kept apart from Report.tsx so the tests can check the wording.
import type { Difficulty, HelpLevel, ModeChange } from '../engine/types'

const HELP_NAMES: Record<HelpLevel, string> = { guided: 'Guided', hints: 'Hints', checkin: 'Check-in' }

// "Auto: Guided -> Hints after stroke 5 -> Check-in after stroke 10", or the one level if it never changed.
export function describeModeHistory(history: ModeChange[], startLevel: HelpLevel = 'guided'): string {
  if (history.length === 0) return `Stayed on ${HELP_NAMES[startLevel]} the whole lesson`
  const steps = history.map((c) => `${HELP_NAMES[c.to]} after stroke ${c.atStroke}`)
  return `${HELP_NAMES[history[0].from]} → ${steps.join(' → ')}`
}

// The size note, shown only when the whole drawing was more than 15% smaller or bigger than the target.
// overallScale 0.7 means "drew 30% smaller". Scale is never counted against the user, and the note says so.
export function describeScale(overallScale: number): string | null {
  if (overallScale >= 0.85 && overallScale <= 1.15) return null
  const percent = Math.round(Math.abs(1 - overallScale) * 100)
  const way = overallScale < 1 ? 'smaller' : 'bigger'
  return `Drew ${percent}% ${way} than the target (not counted against you)`
}

// The score change as a badge: "+31", "−4" or "±0".
export function formatChange(before: number, after: number): string {
  const change = after - before
  if (change > 0) return `+${change}`
  if (change < 0) return `−${Math.abs(change)}`
  return '±0'
}

// The words under the change badge: "points better", "points lower" or "no change".
export function changeWords(before: number, after: number): string {
  if (after > before) return after - before === 1 ? 'point better' : 'points better'
  if (after < before) return before - after === 1 ? 'point lower' : 'points lower'
  return 'no change'
}

// Why a round scored 0 when nothing was drawn in it (Skip, or the timer ran out), or null when both had lines.
export function emptyRoundNote(testEmpty: boolean, retestEmpty: boolean): string | null {
  if (testEmpty && retestEmpty) return 'Nothing was drawn in either round, so there is nothing to compare yet. Try the lesson again and draw both times.'
  if (testEmpty) return 'The test was skipped with nothing drawn, so it counts as 0. The retest score is your real result.'
  if (retestEmpty) return 'The retest was skipped with nothing drawn, so it counts as 0. Draw the retest to see how much the lesson helped.'
  return null
}

// The next harder difficulty the subject has, if any (simple -> medium -> detailed).
export function harderDifficulty(current: Difficulty, available: Partial<Record<Difficulty, string>>): Difficulty | null {
  const order: Difficulty[] = ['simple', 'medium', 'detailed']
  return order.slice(order.indexOf(current) + 1).find((d) => available[d]) ?? null
}
