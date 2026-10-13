// "Your progress": a small history of finished sessions, kept in the browser's localStorage, so improvement
// across sessions is visible (the report shows one session; this shows many).
//
// Rules this file follows:
// - Pure TypeScript, no React. Every function that reads the clock takes `now`, so tests are deterministic.
// - Every score stored is exactly the engine's Score.total for the test and the retest. The stats below only
//   add, subtract and average those engine numbers; nothing here invents a score.
// - localStorage can throw (private mode, storage full, blocked site data). Every access is wrapped, and the
//   app keeps working with an empty history when storage is not available.
import type { Difficulty, Pack } from '../engine/types'
import { resolveAsset } from './packs'

export const STORAGE_KEY = 'ghostlines.progress.v1'
export const MAX_RECORDS = 50
// Live packs carry their thumbnail as a data: URL. A big one would eat the storage quota, so it is dropped.
export const MAX_THUMB_DATA_URL = 4096

export interface ProgressRecord {
  id: string            // one per finished session, used to never save the same session twice
  packId: string
  subject: string       // pack.subject, e.g. "cat": personal bests are per subject
  title: string         // pack.title, e.g. "Cat"
  difficulty: Difficulty
  thumb: string | null  // a URL the browser can load, or null when there is none worth storing
  testScore: number     // engine.score(testAnalysis).total
  retestScore: number   // engine.score(retestAnalysis).total
  at: number            // when the session finished, in ms since 1970
}

// The part of the Storage API this file uses, so tests can pass a fake (or one that throws).
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// window.localStorage, or null when there is none or merely touching it throws (some privacy settings do).
function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

// ---------- reading and writing ----------

const DIFFICULTIES: readonly Difficulty[] = ['simple', 'medium', 'detailed']

// Old or hand-edited storage could hold anything, so each record is checked before it is trusted.
function isRecord(value: unknown): value is ProgressRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  const isNumber = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  return typeof r.id === 'string' && typeof r.packId === 'string' && typeof r.subject === 'string'
    && typeof r.title === 'string' && DIFFICULTIES.includes(r.difficulty as Difficulty)
    && (r.thumb === null || typeof r.thumb === 'string')
    && isNumber(r.testScore) && isNumber(r.retestScore) && isNumber(r.at)
}

// All saved sessions, oldest first. Empty when storage is missing, broken or throws.
export function loadHistory(storage: StorageLike | null = browserStorage()): ProgressRecord[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord).sort((a, b) => a.at - b.at)
  } catch {
    return []
  }
}

// Adds one session and returns the new history. A record whose id is already saved is ignored, so calling
// this twice for one session (React StrictMode runs effects twice in development) saves it once.
// Only the newest MAX_RECORDS are kept. If writing fails, the history is returned as it would have been.
export function saveSession(record: ProgressRecord, storage: StorageLike | null = browserStorage()): ProgressRecord[] {
  const history = loadHistory(storage)
  if (history.some((r) => r.id === record.id)) return history
  const next = [...history, record].sort((a, b) => a.at - b.at).slice(-MAX_RECORDS)
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage is full or blocked: the session simply isn't remembered. Nothing to tell the user.
  }
  return next
}

export function clearHistory(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: if storage can't be changed there is no saved history to show either way.
  }
}

// ---------- building a record ----------

// One stable id per object (the retest Analysis): the same session always gets the same id, even if the
// report screen renders or mounts again. A WeakMap lets the analysis be garbage-collected as usual.
const ids = new WeakMap<object, string>()
let counter = 0
export function sessionIdFor(key: object, now: number): string {
  let id = ids.get(key)
  if (!id) {
    counter += 1
    id = `${now.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    ids.set(key, id)
  }
  return id
}

// The thumbnail URL worth storing: pack folder images become a short URL; a large data: URL becomes null.
export function thumbFor(pack: Pack): string | null {
  if (!pack.thumb) return null
  const url = resolveAsset(pack, pack.thumb)
  if (url.startsWith('data:') && url.length > MAX_THUMB_DATA_URL) return null
  return url
}

export function makeRecord(pack: Pack, testScore: number, retestScore: number, id: string, now: number): ProgressRecord {
  return {
    id,
    packId: pack.id,
    subject: pack.subject,
    title: pack.title,
    difficulty: pack.difficulty,
    thumb: thumbFor(pack),
    testScore,
    retestScore,
    at: now,
  }
}

// ---------- stats ----------

export const gainOf = (r: ProgressRecord) => r.retestScore - r.testScore

// "+12", "−4" or "±0" (the same style as the report's change badge).
export function formatGain(gain: number): string {
  if (gain > 0) return `+${gain}`
  if (gain < 0) return `−${Math.abs(gain)}`
  return '±0'
}

// A local calendar day as a sortable key, e.g. "2026-10-13". Local (not UTC), because a streak is about the
// user's own days: a session at 11 PM and one at 8 AM the next morning are two days in a row.
function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The day before, built from the calendar (not "minus 24 hours", which breaks on daylight-saving days).
function previousDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime()
}

// Consecutive local days with at least one session. The streak is still live if the last session was today
// or yesterday (you haven't broken it until a whole day passes without drawing).
export function dayStreak(records: ProgressRecord[], now: number): number {
  const days = new Set(records.map((r) => dayKey(r.at)))
  let cursor = now
  if (!days.has(dayKey(cursor))) {
    cursor = previousDay(cursor)
    if (!days.has(dayKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak += 1
    cursor = previousDay(cursor)
  }
  return streak
}

export interface ProgressStats {
  sessions: number
  averageGain: number                    // rounded to a whole point
  bestGain: number
  streak: number                         // days
  bestBySubject: Record<string, number>  // the highest retest score per subject
}

export function computeStats(records: ProgressRecord[], now: number): ProgressStats {
  const gains = records.map(gainOf)
  const bestBySubject: Record<string, number> = {}
  for (const r of records) bestBySubject[r.subject] = Math.max(bestBySubject[r.subject] ?? -Infinity, r.retestScore)
  return {
    sessions: records.length,
    averageGain: gains.length ? Math.round(gains.reduce((a, b) => a + b, 0) / gains.length) : 0,
    bestGain: gains.length ? Math.max(...gains) : 0,
    streak: dayStreak(records, now),
    bestBySubject,
  }
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

// The short lines under the report's score, each one only when it is true:
// a personal best (beats every earlier retest on this subject), a streak of 2+ days, and the lesson count
// with the average gain (from the 2nd lesson on). `earlier` is the history before this session.
export interface Highlight {
  kind: 'best' | 'streak' | 'count'
  text: string
}

export function reportHighlights(earlier: ProgressRecord[], current: ProgressRecord, now: number): Highlight[] {
  const others = earlier.filter((r) => r.id !== current.id)
  const all = [...others, current]
  const stats = computeStats(all, now)
  const lines: Highlight[] = []

  const sameSubject = others.filter((r) => r.subject === current.subject)
  if (sameSubject.length > 0 && current.retestScore > Math.max(...sameSubject.map((r) => r.retestScore))) {
    lines.push({ kind: 'best', text: `Personal best for ${current.title}` })
  }
  if (stats.streak >= 2) lines.push({ kind: 'streak', text: `${stats.streak}-day streak` })
  if (stats.sessions >= 2) lines.push({ kind: 'count', text: `Your ${ordinal(stats.sessions)} lesson, average ${formatGain(stats.averageGain)}` })
  return lines
}

// "Today", "Yesterday", or a short date like "Oct 9", for the recent-sessions list.
export function relativeDay(at: number, now: number): string {
  if (dayKey(at) === dayKey(now)) return 'Today'
  if (dayKey(at) === dayKey(previousDay(now))) return 'Yesterday'
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
