import { describe, expect, it } from 'vitest'
import type { UserStroke } from '../../engine/types'
import { applyHistory, HISTORY_LIMIT, type HistoryState } from '../useStrokeHistory'

const stroke = (x: number): UserStroke => ({ points: [[x, 0, 0.5, 0], [x, 10, 0.5, 16]] })
const empty: HistoryState = { past: [], present: [] }

describe('applyHistory (the undo history behind useStrokeHistory)', () => {
  it('undoes strokes one at a time', () => {
    const a = stroke(1)
    const b = stroke(2)
    let state = applyHistory(empty, { type: 'push', stroke: a })
    state = applyHistory(state, { type: 'push', stroke: b })
    expect(state.present).toEqual([a, b])
    state = applyHistory(state, { type: 'undo' })
    expect(state.present).toEqual([a])
    state = applyHistory(state, { type: 'undo' })
    expect(state.present).toEqual([])
    expect(applyHistory(state, { type: 'undo' })).toBe(state) // nothing left to undo
  })

  it('undoes a whole eraser gesture in one step, bringing back the original strokes', () => {
    const a = stroke(1)
    const drawn = applyHistory(empty, { type: 'push', stroke: a })
    const pieces = [stroke(1), stroke(1)]
    const erased = applyHistory(drawn, { type: 'replace', strokes: pieces })
    expect(erased.present).toBe(pieces)
    expect(applyHistory(erased, { type: 'undo' }).present).toEqual([a])
  })

  it('adds no history for an eraser gesture that removed nothing', () => {
    const drawn = applyHistory(empty, { type: 'push', stroke: stroke(1) })
    expect(applyHistory(drawn, { type: 'replace', strokes: drawn.present })).toBe(drawn)
  })

  it('makes Clear undoable, and ignores Clear on an empty canvas', () => {
    const a = stroke(1)
    const drawn = applyHistory(empty, { type: 'push', stroke: a })
    const cleared = applyHistory(drawn, { type: 'clear' })
    expect(cleared.present).toEqual([])
    expect(applyHistory(cleared, { type: 'undo' }).present).toEqual([a])
    expect(applyHistory(empty, { type: 'clear' })).toBe(empty)
  })

  it('keeps at most HISTORY_LIMIT steps', () => {
    let state = empty
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) state = applyHistory(state, { type: 'push', stroke: stroke(i) })
    expect(state.past).toHaveLength(HISTORY_LIMIT)
  })
})
