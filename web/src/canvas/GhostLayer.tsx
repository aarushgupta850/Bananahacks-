// Ghost lines: the teacher's guides, drawn over the canvas in the accent color at 30% opacity.
// It ignores the pointer, so drawing goes straight through it.
// - a new 'stroke' ghost draws itself on in 400 ms; key points and construction shapes fade in
// - a ghost that disappears (its step was completed) fades out over 200 ms instead of vanishing
// - with prefers-reduced-motion the CSS turns every animation off, so ghosts simply appear and disappear
import { useEffect, useRef, useState } from 'react'
import type { Ghost } from '../engine/types'
import { TARGET_SIZE, toSvgPoints } from './geometry'
import './canvas.css'

const FADE_OUT_MS = 200

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

export default function GhostLayer({ ghosts }: { ghosts: Ghost[] }) {
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
