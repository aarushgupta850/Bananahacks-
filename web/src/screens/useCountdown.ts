// A countdown that calls onEnd once when it reaches 0. `remaining` is in whole seconds.
// It counts from a fixed start time, so it stays accurate even when the tab is slow to re-render.
import { useEffect, useRef, useState } from 'react'

export function useCountdown(seconds: number, onEnd: () => void, running = true): number {
  const [remaining, setRemaining] = useState(seconds)
  // The latest onEnd, so the timer never calls an old one (which would see old state).
  const endRef = useRef(onEnd)
  useEffect(() => {
    endRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    if (!running) return
    const start = performance.now()
    let ended = false
    const timer = window.setInterval(() => {
      const left = Math.max(0, seconds - Math.floor((performance.now() - start) / 1000))
      setRemaining(left)
      if (left === 0 && !ended) {
        ended = true
        window.clearInterval(timer)
        endRef.current()
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [seconds, running])

  return remaining
}
