// Ghost lines: the teacher's guides, drawn over the canvas in the accent color at 30% opacity.
// It ignores the pointer, so drawing goes straight through it.
// - a new 'stroke' ghost draws itself on in 400 ms; key points and construction shapes fade in
// - a ghost that disappears (its step was completed) fades out over 200 ms instead of vanishing
// - a ghost that moves (the guides settle onto the user's drawing during the first strokes) glides there in
//   300 ms instead of jumping
// - with prefers-reduced-motion the CSS turns every animation off, so ghosts simply appear and disappear (and jump)
// - a guide line shows where to start and which way to go (a dot and a small arrow at its start)
// - with `ink` (the user's strokes), the stretches of a guide already traced are drawn stronger, so the user sees
//   what is left of the line. This is only a picture: the teacher alone decides when a guide is drawn.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ghost, Point, UserStroke } from '../engine/types'
import { TARGET_SIZE, toSvgPoints } from './geometry'
import './canvas.css'

const FADE_OUT_MS = 200
const TRACED_PX = 16 // a guide point counts as traced when ink passes this close (target space)
const ARROW_AT_PX = 34 // the direction arrow sits this far along the guide from its start

// Each stretch of the guide that ink has passed close to (runs of 2+ points), for the "already traced" overlay.
function tracedRuns(points: Point[], ink: Point[][]): Point[][] {
  if (ink.length === 0) return []
  const cell = TRACED_PX
  const grid = new Map<string, Point[]>()
  for (const line of ink) for (const p of line) {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(p)
    else grid.set(key, [p])
  }
  const near = ([x, y]: Point) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const q of grid.get(`${cx + i},${cy + j}`) ?? []) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 <= cell * cell) return true
    }
    return false
  }
  const runs: Point[][] = []
  let run: Point[] = []
  for (const p of points) {
    if (near(p)) run.push(p)
    else {
      if (run.length >= 2) runs.push(run)
      run = []
    }
  }
  if (run.length >= 2) runs.push(run)
  return runs
}

// The point ARROW_AT_PX along the line, and the direction there (unit vector), for the start arrow.
function arrowAlong(points: Point[]): { at: Point; dir: Point } | null {
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i]
    const d = Math.hypot(bx - ax, by - ay)
    if (d > 0 && walked + d >= ARROW_AT_PX) {
      const t = (ARROW_AT_PX - walked) / d
      return { at: [ax + (bx - ax) * t, ay + (by - ay) * t], dir: [(bx - ax) / d, (by - ay) / d] }
    }
    walked += d
  }
  return null // shorter than ARROW_AT_PX: a dot is enough
}

// Where to start and which way to go: a dot at the start, and a small chevron a little way along.
function StartMarker({ points }: { points: Point[] }) {
  const arrow = arrowAlong(points)
  const [x, y] = points[0]
  return (
    <g className="ghost-start">
      <circle cx={x} cy={y} r={7} />
      {arrow && (() => {
        const { at: [ax, ay], dir: [dx, dy] } = arrow
        const size = 10
        // A chevron pointing along the line: two short arms back from the tip.
        const left = [ax - dx * size - dy * size * 0.7, ay - dy * size + dx * size * 0.7]
        const right = [ax - dx * size + dy * size * 0.7, ay - dy * size - dx * size * 0.7]
        return <polyline points={`${left[0]},${left[1]} ${ax},${ay} ${right[0]},${right[1]}`} />
      })()}
    </g>
  )
}
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

export default function GhostLayer({ ghosts: target, ink }: { ghosts: Ghost[]; ink?: UserStroke[] }) {
  const ghosts = useGlide(target)
  const inkPoints = useMemo(() => (ink ?? []).map((s) => s.points.map(([x, y]): Point => [x, y])), [ink])
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
      {/* Stretches already traced, stronger; then where each full guide line starts and which way it goes. */}
      {ghosts.filter((g) => g.kind !== 'keypoints').flatMap((g) => tracedRuns(g.points, inkPoints)
        .map((run, i) => <polyline key={`traced-${ghostKey(g)}-${i}`} className="ghost-traced" points={toSvgPoints(run)} />))}
      {ghosts.filter((g) => g.kind === 'stroke' && g.points.length > 1)
        .map((g) => <StartMarker key={`start-${ghostKey(g)}`} points={g.points} />)}
    </svg>
  )
}
