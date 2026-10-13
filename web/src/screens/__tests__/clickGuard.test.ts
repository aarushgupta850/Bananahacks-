import { describe, expect, it } from 'vitest'
import { clickCounts, NEXT_GUARD_MS } from '../clickGuard'

describe('main-button click guard', () => {
  it('ignores the second click of a double-click that lands on the next screen', () => {
    expect(clickCounts(1000, 1000)).toBe(false)
    expect(clickCounts(1000, 1000 + 120)).toBe(false) // a typical double-click gap
    expect(clickCounts(1000, 1000 + NEXT_GUARD_MS - 1)).toBe(false)
  })

  it('counts every click once the screen has been up for a moment', () => {
    expect(clickCounts(1000, 1000 + NEXT_GUARD_MS)).toBe(true)
    expect(clickCounts(1000, 60_000)).toBe(true)
  })
})
