import { describe, expect, it } from 'vitest'
import { changeWords, describeModeHistory, describeScale, emptyRoundNote, formatChange, harderDifficulty } from '../reportText'

describe('describeModeHistory', () => {
  it('says when the help level never changed', () => {
    expect(describeModeHistory([])).toBe('Stayed on Guided the whole lesson')
  })

  it('lists each change with the stroke it happened at', () => {
    expect(describeModeHistory([
      { atStroke: 5, from: 'guided', to: 'hints' },
      { atStroke: 10, from: 'hints', to: 'checkin' },
    ])).toBe('Guided → Hints after stroke 5 → Check-in after stroke 10')
  })
})

describe('describeScale', () => {
  it('stays quiet within 15% of the target size', () => {
    expect(describeScale(0.9)).toBeNull()
    expect(describeScale(1.15)).toBeNull()
  })

  it('names the size difference otherwise', () => {
    expect(describeScale(0.7)).toBe('Drew 30% smaller than the target (not counted against you)')
    expect(describeScale(1.2)).toBe('Drew 20% bigger than the target (not counted against you)')
  })
})

describe('formatChange', () => {
  it('signs the difference', () => {
    expect(formatChange(48, 79)).toBe('+31')
    expect(formatChange(60, 56)).toBe('−4')
    expect(formatChange(50, 50)).toBe('±0')
  })
})

describe('harderDifficulty', () => {
  it('finds the next harder level the subject has', () => {
    expect(harderDifficulty('simple', { simple: 'a', detailed: 'c' })).toBe('detailed')
    expect(harderDifficulty('medium', { medium: 'b', detailed: 'c' })).toBe('detailed')
    expect(harderDifficulty('detailed', { detailed: 'c' })).toBeNull()
  })
})

describe('changeWords', () => {
  it('says which way the score moved, never "better" for a drop', () => {
    expect(changeWords(48, 79)).toBe('points better')
    expect(changeWords(60, 56)).toBe('points lower')
    expect(changeWords(60, 61)).toBe('point better')
    expect(changeWords(50, 50)).toBe('no change')
  })
})

describe('emptyRoundNote', () => {
  it('explains a 0 from a round with nothing drawn', () => {
    expect(emptyRoundNote(false, false)).toBeNull()
    expect(emptyRoundNote(true, false)).toMatch(/test was skipped/)
    expect(emptyRoundNote(false, true)).toMatch(/retest was skipped/)
    expect(emptyRoundNote(true, true)).toMatch(/either round/)
  })
})
