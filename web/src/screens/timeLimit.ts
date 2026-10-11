// The time limit for the solo rounds (test and retest), and how it is written on screen.
// null means no time limit.

export const CUSTOM_MIN_SECONDS = 10
export const CUSTOM_MAX_SECONDS = 600

// The ready-made choices on the Reference screen (Custom is offered separately).
export const PRESET_SECONDS: (number | null)[] = [30, 45, 60, 120, null]

// "30 s", "1 min", "1 min 30 s", "2 min".
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

// The label of a choice: "45 s", "1 min", "No time limit".
export const choiceLabel = (seconds: number | null) => (seconds === null ? 'No time limit' : formatDuration(seconds))

// For the report card: "Timed: 1 min" or "Untimed".
export const timingLabel = (seconds: number | null) => (seconds === null ? 'Untimed' : `Timed: ${formatDuration(seconds)}`)

// "in 45 seconds", "in 1 minute", "in 1 minute 30 seconds", "with no time limit" (for running text).
export function withinPhrase(seconds: number | null): string {
  if (seconds === null) return 'with no time limit'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const parts = [minutes > 0 ? plural(minutes, 'minute') : '', rest > 0 ? plural(rest, 'second') : ''].filter(Boolean)
  return `in ${parts.join(' ')}`
}

// A typed custom value as whole seconds, or null when it isn't a whole number from 10 to 600.
export function parseCustomSeconds(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null
  const n = Number(text)
  return n >= CUSTOM_MIN_SECONDS && n <= CUSTOM_MAX_SECONDS ? n : null
}
