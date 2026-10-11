// A ring that empties as time runs out, with the seconds left in the middle.
// The last 10 seconds turn the ring to the warning color AND say "seconds left", so color is never the only signal.
const RADIUS = 26
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function CountdownRing({ remaining, total }: { remaining: number; total: number }) {
  const low = remaining <= 10
  return (
    <div className={low ? 'countdown is-low' : 'countdown'} role="timer" aria-label={`${remaining} seconds left`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="countdown-track" cx="32" cy="32" r={RADIUS} />
        <circle
          className="countdown-fill"
          cx="32"
          cy="32"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - remaining / total)}
        />
      </svg>
      <span className="countdown-number" aria-hidden="true">{remaining}</span>
      {low && <span className="countdown-note" aria-hidden="true">seconds left</span>}
    </div>
  )
}
