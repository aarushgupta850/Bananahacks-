// Ghost lines: the teacher's guides, drawn over the canvas in the accent color at 30% opacity.
// It ignores the pointer, so drawing goes straight through it. Basic version: Jeff adds the animations.
import type { Ghost, Point } from '../engine/types'
import { TARGET_SIZE } from './geometry'
import './canvas.css'

const toPoints = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')

function GhostShape({ ghost }: { ghost: Ghost }) {
  // 'keypoints': dots for the user to connect.
  if (ghost.kind === 'keypoints') {
    return (
      <g className="ghost-keypoints">
        {ghost.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8} />)}
      </g>
    )
  }
  // 'stroke' is a full guide line; 'construction' is a helper shape, drawn dashed.
  return <polyline className={`ghost-line ghost-${ghost.kind}`} points={toPoints(ghost.points)} />
}

export default function GhostLayer({ ghosts }: { ghosts: Ghost[] }) {
  return (
    <svg className="ghost-layer" viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`} aria-hidden="true">
      {ghosts.map((ghost) => <GhostShape key={`${ghost.strokeId}-${ghost.kind}`} ghost={ghost} />)}
    </svg>
  )
}
