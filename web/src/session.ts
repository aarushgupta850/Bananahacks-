// Everything one run through the app produces (test -> teach -> retest), shared by the screens through React context.
// These are UI-only types; the engine's types live in engine/types.ts (the contract).
import { createContext, useContext } from 'react'
import type { Analysis, Ghost, ModeChange, Pack, Step, UserStroke, Weakness } from './engine/types'
import type { GenerateRequest } from './lib/live'

// The Teach screen records what happened so the report can replay it (the ReplayPlayer format in Jeff's playbook).
// t is milliseconds since the lesson started. A 'stroke' event carries the user's stroke, a 'ghosts' event the
// ghosts the teacher showed after it.
export interface RecordingEvent {
  t: number
  type: 'stroke' | 'ghosts'
  stroke?: UserStroke
  ghosts?: Ghost[]
}
export interface TeachRecording {
  events: RecordingEvent[]
}

export interface Session {
  pack: Pack | null
  testStrokes: UserStroke[]
  testAnalysis: Analysis | null
  weaknesses: Weakness[]
  steps: Step[]
  teachRecording: TeachRecording
  modeHistory: ModeChange[]
  retestStrokes: UserStroke[]
  retestAnalysis: Analysis | null
  // Time limit for both solo rounds (test and retest), in seconds; null = no time limit.
  // Chosen on the Reference screen and shared by both rounds, so the before/after comparison stays fair.
  soloSeconds: number | null
  // What the user typed or uploaded when live AI made this pack (null for ready-made subjects), so the Reference
  // screen can ask for a new drawing of the same thing.
  liveRequest: GenerateRequest | null
}

// The time limit a new run starts with.
export const DEFAULT_SOLO_SECONDS = 45

export const emptySession: Session = {
  pack: null,
  testStrokes: [],
  testAnalysis: null,
  weaknesses: [],
  steps: [],
  teachRecording: { events: [] },
  modeHistory: [],
  retestStrokes: [],
  retestAnalysis: null,
  soloSeconds: DEFAULT_SOLO_SECONDS,
  liveRequest: null,
}

export interface SessionContextValue {
  session: Session
  update: (changes: Partial<Session>) => void // merges the changes into the session
  restart: () => void                         // clears the session and goes back to the subject picker
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionContext.Provider> (see App.tsx)')
  return value
}

// The loaded pack. App only shows the screens after the subject picker once a pack is loaded,
// so inside those screens this never throws.
export function usePack(): Pack {
  const { pack } = useSession().session
  if (!pack) throw new Error('usePack was called before a pack was loaded')
  return pack
}
