import { describe, expect, it } from 'vitest'
import { choiceLabel, formatDuration, parseCustomSeconds, timingLabel, withinPhrase } from '../timeLimit'

describe('time limit wording', () => {
  it('formats durations', () => {
    expect(formatDuration(30)).toBe('30 s')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(90)).toBe('1 min 30 s')
    expect(formatDuration(120)).toBe('2 min')
  })

  it('labels choices and the report', () => {
    expect(choiceLabel(null)).toBe('No time limit')
    expect(timingLabel(60)).toBe('Timed: 1 min')
    expect(timingLabel(null)).toBe('Untimed')
  })

  it('writes running text', () => {
    expect(withinPhrase(45)).toBe('in 45 seconds')
    expect(withinPhrase(60)).toBe('in 1 minute')
    expect(withinPhrase(121)).toBe('in 2 minutes 1 second')
    expect(withinPhrase(null)).toBe('with no time limit')
  })
})

describe('parseCustomSeconds', () => {
  it('accepts whole seconds from 10 to 600', () => {
    expect(parseCustomSeconds('10')).toBe(10)
    expect(parseCustomSeconds(' 600 ')).toBe(600)
  })

  it('rejects anything else', () => {
    for (const bad of ['', '9', '601', '1.5', '-20', 'abc', '30s']) expect(parseCustomSeconds(bad)).toBeNull()
  })
})
