// The timer: a ring that drains smoothly as time runs out, the time left as m:ss in the middle, and a label.
// The last 10 seconds turn it to the warning color AND change the words to "Hurry! 8 s left", so color is never
// the only signal (the ring also pulses gently, unless the user prefers reduced motion).
const RADIUS = 28
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// 75 -> "1:15", 8 -> "0:08".
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

interface CountdownRingProps {
  remaining: number   // whole seconds left
  total: number       // whole seconds at the start
  label?: string      // what the time is for, e.g. "Time left" or "Lesson time"
  stopped?: boolean   // the clock has stopped (e.g. the lesson is finished): no hurry, whatever is left
}

export default function CountdownRing({ remaining, total, label = 'Time left', stopped = false }: CountdownRingProps) {
  const low = !stopped && remaining <= 10
  const share = total > 0 ? Math.min(1, remaining / total) : 0
  return (
    <div className={low ? 'timer is-low' : 'timer'} role="timer" aria-label={`${label}: ${clock(remaining)}`}>
      <div className="timer-ring">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle className="timer-track" cx="32" cy="32" r={RADIUS} />
          <circle className="timer-fill" cx="32" cy="32" r={RADIUS}
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - share)} />
        </svg>
        <span className="timer-time" aria-hidden="true">{clock(remaining)}</span>
      </div>
      <div className="timer-text" aria-hidden="true">
        <span className="timer-label">{low ? 'Hurry!' : label}</span>
        <span className="timer-sub">{low ? `${remaining} s left` : `of ${clock(total)}`}</span>
      </div>
    </div>
  )
}
