import { describe, expect, it } from 'vitest'
import { foxPack } from '../../engine/__tests__/fixtures'
import {
  clearHistory, computeStats, dayStreak, formatGain, loadHistory, makeRecord, MAX_RECORDS, relativeDay,
  reportHighlights, saveSession, sessionIdFor, STORAGE_KEY, thumbFor, type ProgressRecord, type StorageLike,
} from '../progress'

// An in-memory stand-in for localStorage.
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: (k) => { data.delete(k) },
  }
}

// Storage that throws on every call, like Safari private mode or a full quota.
const throwingStorage: StorageLike = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('quota') },
  removeItem: () => { throw new Error('denied') },
}

// Local-time timestamps, so day boundaries are the same in every time zone the tests run in.
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime()

let n = 0
function record(changes: Partial<ProgressRecord> = {}): ProgressRecord {
  n += 1
  return {
    id: `r${n}`, packId: 'cat-medium', subject: 'cat', title: 'Cat', difficulty: 'medium', thumb: null,
    testScore: 40, retestScore: 60, at: at(10), ...changes,
  }
}

describe('saving and loading', () => {
  it('saves a session and reads it back', () => {
    const storage = memoryStorage()
    const r = record()
    saveSession(r, storage)
    expect(loadHistory(storage)).toEqual([r])
    expect(storage.data.has(STORAGE_KEY)).toBe(true)
  })

  it('saves the same session only once', () => {
    const storage = memoryStorage()
    const r = record()
    saveSession(r, storage)
    saveSession({ ...r }, storage)
    expect(loadHistory(storage)).toHaveLength(1)
  })

  it('keeps only the newest records', () => {
    const storage = memoryStorage()
    for (let i = 0; i < MAX_RECORDS + 5; i++) saveSession(record({ at: at(1) + i * 1000, testScore: i }), storage)
    const history = loadHistory(storage)
    expect(history).toHaveLength(MAX_RECORDS)
    expect(history[0].testScore).toBe(5) // the five oldest were dropped
    expect(history[MAX_RECORDS - 1].testScore).toBe(MAX_RECORDS + 4)
  })

  it('keeps working when storage throws', () => {
    expect(loadHistory(throwingStorage)).toEqual([])
    const r = record()
    expect(saveSession(r, throwingStorage)).toEqual([r])
    expect(() => clearHistory(throwingStorage)).not.toThrow()
    expect(loadHistory(null)).toEqual([])
  })

  it('ignores broken or foreign data in storage', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, '{not json')
    expect(loadHistory(storage)).toEqual([])
    const good = record()
    storage.setItem(STORAGE_KEY, JSON.stringify([good, { id: 'x', testScore: 'high' }, null]))
    expect(loadHistory(storage)).toEqual([good])
  })

  it('clears the history', () => {
    const storage = memoryStorage()
    saveSession(record(), storage)
    clearHistory(storage)
    expect(loadHistory(storage)).toEqual([])
  })
})

describe('building a record', () => {
  it('copies the pack fields and the engine scores as they are', () => {
    const r = makeRecord(foxPack, 37, 64, 'id-1', at(12))
    expect(r).toMatchObject({ id: 'id-1', packId: foxPack.id, subject: foxPack.subject, title: foxPack.title, testScore: 37, retestScore: 64, at: at(12) })
    expect(r.thumb).toContain(foxPack.id)
  })

  it('drops large data: thumbnails but keeps small ones', () => {
    expect(thumbFor({ ...foxPack, thumb: 'data:image/png;base64,' + 'A'.repeat(10_000) })).toBeNull()
    expect(thumbFor({ ...foxPack, thumb: 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA')
  })

  it('gives one object the same id every time', () => {
    const key = {}
    expect(sessionIdFor(key, 1)).toBe(sessionIdFor(key, 2))
    expect(sessionIdFor({}, 1)).not.toBe(sessionIdFor(key, 1))
  })
})

describe('day streak', () => {
  it('counts consecutive days ending today', () => {
    const records = [record({ at: at(11) }), record({ at: at(12, 9) }), record({ at: at(12, 20) }), record({ at: at(13, 8) })]
    expect(dayStreak(records, at(13, 22))).toBe(3)
  })

  it('stays live when the last session was yesterday', () => {
    expect(dayStreak([record({ at: at(11) }), record({ at: at(12) })], at(13))).toBe(2)
  })

  it('is broken by a gap', () => {
    const records = [record({ at: at(8) }), record({ at: at(9) }), record({ at: at(11) }), record({ at: at(12) })]
    expect(dayStreak(records, at(12))).toBe(2) // the 10th is missing
    expect(dayStreak(records, at(14))).toBe(0) // nothing today or yesterday
  })

  it('treats 11 PM and 8 AM the next morning as two days', () => {
    expect(dayStreak([record({ at: at(12, 23) }), record({ at: at(13, 8) })], at(13, 9))).toBe(2)
  })

  it('is zero with no sessions', () => {
    expect(dayStreak([], at(13))).toBe(0)
  })
})

describe('stats', () => {
  it('works out sessions, average and best gain, and best per subject', () => {
    const records = [
      record({ subject: 'cat', testScore: 40, retestScore: 60 }), // +20
      record({ subject: 'cat', testScore: 50, retestScore: 55 }), // +5
      record({ subject: 'fox', testScore: 70, retestScore: 66 }), // -4
    ]
    const stats = computeStats(records, at(10))
    expect(stats.sessions).toBe(3)
    expect(stats.averageGain).toBe(7) // 21 / 3
    expect(stats.bestGain).toBe(20)
    expect(stats.streak).toBe(1)
    expect(stats.bestBySubject).toEqual({ cat: 60, fox: 66 })
  })

  it('is all zero with no sessions', () => {
    expect(computeStats([], at(10))).toEqual({ sessions: 0, averageGain: 0, bestGain: 0, streak: 0, bestBySubject: {} })
  })

  it('formats gains like the report badge', () => {
    expect([formatGain(12), formatGain(-4), formatGain(0)]).toEqual(['+12', '−4', '±0'])
  })
})

describe('report highlights', () => {
  it('says nothing special on the very first lesson', () => {
    expect(reportHighlights([], record(), at(10))).toEqual([])
  })

  it('notes a personal best, a streak and the lesson count when each is true', () => {
    const earlier = [record({ at: at(9), testScore: 30, retestScore: 50 })] // +20
    const now = record({ at: at(10), testScore: 40, retestScore: 64 })      // +24
    expect(reportHighlights(earlier, now, at(10))).toEqual([
      'Personal best for Cat', '2-day streak', 'Your 2nd lesson, average +22',
    ])
  })

  it('does not call it a personal best when an earlier retest was as good', () => {
    const earlier = [record({ at: at(10, 9), retestScore: 70 })]
    const lines = reportHighlights(earlier, record({ at: at(10, 11), retestScore: 70 }), at(10, 11))
    expect(lines).toEqual(['Your 2nd lesson, average +30']) // both 40 -> 70
  })

  it('does not count the current session twice if it is already saved', () => {
    const current = record()
    expect(reportHighlights([current], current, at(10))).toEqual([])
  })
})

describe('relative day', () => {
  it('says Today and Yesterday', () => {
    expect(relativeDay(at(13, 8), at(13, 20))).toBe('Today')
    expect(relativeDay(at(12, 23), at(13, 1))).toBe('Yesterday')
    expect(relativeDay(at(3), at(13))).not.toMatch(/Today|Yesterday/)
  })
})
