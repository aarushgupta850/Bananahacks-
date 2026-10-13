// Undo for the drawing canvas. Every change to the list of strokes is one undoable step: a new stroke, one
// whole eraser gesture (however many pointer moves it took) or Clear. Undo puts the list back exactly as it
// was before that step, so it works the same after erasing as after drawing.
//
// The parent still owns the list (the session for Test and Retest, local state in the lesson): this hook only
// remembers earlier versions of it and hands the parent the new list to store.
import { useState } from 'react'
import type { UserStroke } from '../engine/types'

// Plenty for a 45 s round or a 2 min lesson, and it keeps memory bounded on very long sessions.
export const HISTORY_LIMIT = 200

export type HistoryAction =
  | { type: 'push'; stroke: UserStroke }       // a finished stroke
  | { type: 'replace'; strokes: UserStroke[] } // an eraser gesture's result
  | { type: 'clear' }
  | { type: 'undo' }

export interface HistoryState {
  past: UserStroke[][] // earlier versions of the list, oldest first
  present: UserStroke[]
}

// The pure part, so it can be unit-tested without React. Returns the same state object when nothing changes.
export function applyHistory(state: HistoryState, action: HistoryAction): HistoryState {
  const commit = (next: UserStroke[]): HistoryState => ({ past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next })
  switch (action.type) {
    case 'push':
      return commit([...state.present, action.stroke])
    case 'replace':
      // An eraser gesture that rubbed out nothing hands back the same list: no history entry for it.
      return action.strokes === state.present ? state : commit(action.strokes)
    case 'clear':
      return state.present.length === 0 ? state : commit([])
    case 'undo':
      return state.past.length === 0 ? state : { past: state.past.slice(0, -1), present: state.past[state.past.length - 1] }
  }
}

export function useStrokeHistory(strokes: UserStroke[], setStrokes: (next: UserStroke[]) => void) {
  const [past, setPast] = useState<UserStroke[][]>([])

  // Every action runs from an event handler (one per pointer-up or button press), so `strokes` is current.
  function run(action: HistoryAction) {
    const next = applyHistory({ past, present: strokes }, action)
    if (next.past !== past) setPast(next.past)
    if (next.present !== strokes) setStrokes(next.present)
  }

  return {
    push: (stroke: UserStroke) => run({ type: 'push', stroke }),
    replace: (next: UserStroke[]) => run({ type: 'replace', strokes: next }),
    clear: () => run({ type: 'clear' }),
    undo: () => run({ type: 'undo' }),
    canUndo: past.length > 0,
  }
}
