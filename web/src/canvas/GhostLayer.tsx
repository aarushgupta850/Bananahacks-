// Ghost lines: the teacher's guides, drawn over the canvas in the accent color at 30% opacity.
// It ignores the pointer, so drawing goes straight through it.
// - a new 'stroke' ghost draws itself on in 400 ms; key points and construction shapes fade in
// - a ghost that disappears (its step was completed) fades out over 200 ms instead of vanishing
// - a ghost that moves (the guides settle onto the user's drawing during the first strokes) glides there in
//   300 ms instead of jumping
// - with prefers-reduced-motion the CSS turns every animation off, so ghosts simply appear and disappear (and jump)
import { useEffect, useRef, useState } from 'react'
import type { Ghost } from '../engine/types'
import { TARGET_SIZE, toSvgPoints } from './geometry'
import './canvas.css'

const FADE_OUT_MS = 200
const GLIDE_MS = 300

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The ghosts as drawn: the same as `ghosts`, except that a ghost which moved (same line, new place) eases from
// where it was to where it is now, so the guides glide instead of jumping.
function useGlide(ghosts: Ghost[]): Ghost[] {
  const [shown, setShown] = useState(ghosts)
  const drawn = useRef(ghosts) // what is on screen right now (mid-glide too)
  useEffect(() => {
    const from = new Map(drawn.current.map((g) => [ghostKey(g), g.points]))
    const moves = ghosts.some((g) => {
      const old = from.get(ghostKey(g))
      return old && old.length === g.points.length && old.some((p, i) => p[0] !== g.points[i][0] || p[1] !== g.points[i][1])
    })
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = moves && !reducedMotion() ? Math.min(1, (now - start) / GLIDE_MS) : 1
      const e = 1 - (1 - t) ** 3 // ease out
      const next = ghosts.map((g) => {
        const old = from.get(ghostKey(g))
        if (!old || old.length !== g.points.length || t >= 1) return g
        return { ...g, points: g.points.map(([x, y], i) => [old[i][0] + (x - old[i][0]) * e, old[i][1] + (y - old[i][1]) * e] as [number, number]) }
      })
      drawn.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [ghosts])
  return shown
}

const ghostKey = (ghost: Ghost) => `${ghost.strokeId}-${ghost.kind}`

function GhostShape({ ghost, leaving }: { ghost: Ghost; leaving: boolean }) {
  const state = leaving ? ' is-leaving' : ''
  // 'keypoints': dots for the user to connect.
  if (ghost.kind === 'keypoints') {
    return (
      <g className={`ghost-keypoints${state}`}>
        {ghost.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={11} />)}
      </g>
    )
  }
  // 'stroke' is a full guide line; 'construction' is a helper shape, drawn dashed.
  // pathLength=1 lets the CSS animate stroke-dashoffset from 1 to 0 whatever the line's real length.
  return (
    <polyline
      className={`ghost-line ghost-${ghost.kind}${state}`}
      points={toSvgPoints(ghost.points)}
      pathLength={ghost.kind === 'stroke' ? 1 : undefined}
    />
  )
}

export default function GhostLayer({ ghosts: target }: { ghosts: Ghost[] }) {
  const ghosts = useGlide(target)
  // Ghosts that were just removed, kept on screen while they fade out.
  const [leaving, setLeaving] = useState<Ghost[]>([])
  const previous = useRef<Ghost[]>(ghosts)
  const timers = useRef<number[]>([])

  // Cancel pending fade-outs only when the layer itself goes away.
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    const now = new Set(ghosts.map(ghostKey))
    const gone = previous.current.filter((g) => !now.has(ghostKey(g)))
    previous.current = ghosts
    if (gone.length === 0) return
    // A ghost that comes back while fading out is shown normally again, so drop it from `leaving`.
    // Also drop an older copy of a ghost that is leaving again, so no key appears twice.
    const goneKeys = new Set(gone.map(ghostKey))
    setLeaving((old) => [...old.filter((g) => !now.has(ghostKey(g)) && !goneKeys.has(ghostKey(g))), ...gone])
    // Not cleared when the ghosts change again: every fade-out must finish, or a ghost would stay on screen.
    timers.current.push(window.setTimeout(() => {
      setLeaving((old) => old.filter((g) => !gone.includes(g)))
    }, FADE_OUT_MS))
  }, [ghosts])

  const current = new Set(ghosts.map(ghostKey))
  return (
    <svg className="ghost-layer" viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`} aria-hidden="true">
      {leaving.filter((g) => !current.has(ghostKey(g))).map((ghost) => (
        <GhostShape key={`leaving-${ghostKey(ghost)}`} ghost={ghost} leaving />
      ))}
      {ghosts.map((ghost) => <GhostShape key={ghostKey(ghost)} ghost={ghost} leaving={false} />)}
    </svg>
  )
}
