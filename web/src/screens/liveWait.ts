// The text under the loader while the live server makes a lesson. A lesson takes 20-40 s, and up to about a minute
// when the server's draft check (Gemini) finds no clean draft and the AI draws again, so the text changes as time
// passes instead of promising one number.
import { useEffect, useState } from 'react'

const STAGES: { after: number; text: string }[] = [
  { after: 0, text: 'Drawing a few drafts… this usually takes 20 to 40 seconds.' },
  { after: 25, text: 'Checking the drafts and tracing the cleanest one…' },
  { after: 50, text: 'Still going: when no draft is clean, the AI draws again. Almost there…' },
]
const WAITING = 'Someone else is drawing right now. You’re next, hold on…'

export function liveWaitText(secondsWaited: number, waitingForOthers: boolean): string {
  if (waitingForOthers) return WAITING
  return STAGES.filter((stage) => secondsWaited >= stage.after).at(-1)!.text
}

// Seconds since `active` became true (0 while it is false), ticking once a second.
export function useSecondsSince(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const start = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => {
      window.clearInterval(timer)
      setSeconds(0) // the next wait starts from 0
    }
  }, [active])
  return active ? seconds : 0
}
