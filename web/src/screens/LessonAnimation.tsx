// The last stage of "How this lesson was made": the pack's strokes drawing themselves in lesson order,
// numbered and colored by tier, over a faint copy of the target. It is live, not an image, so it shows exactly
// the order the lesson will teach. Under prefers-reduced-motion every stroke is simply shown.
import type { CSSProperties } from 'react'
import type { Pack, Point } from '../engine/types'
import { resolveAsset } from '../lib/packs'
import { lessonOrder } from './lessonOrder'

// The whole animation lasts at most this long, however many strokes the pack has.
const MAX_TOTAL_MS = 7000
const MAX_STEP_MS = 350

const toPoints = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')

interface LessonAnimationProps {
  pack: Pack
  run: number // change it to replay the animation from the start
}

export default function LessonAnimation({ pack, run }: LessonAnimationProps) {
  const strokes = lessonOrder(pack)
  const stepMs = Math.min(MAX_STEP_MS, MAX_TOTAL_MS / Math.max(strokes.length, 1))
  // Numbers would cover a busy drawing, so with many strokes only every few get one (always the first).
  const numberEvery = strokes.length > 30 ? 5 : strokes.length > 15 ? 2 : 1

  return (
    <svg key={run} className="lesson-animation" viewBox="0 0 768 768" role="img"
      aria-label={`The ${strokes.length} strokes of this lesson, drawn in the order you will learn them`}>
      <image href={resolveAsset(pack, pack.target)} x={0} y={0} width={768} height={768} className="lesson-animation-target" />
      {strokes.map((stroke, i) => (
        <polyline
          key={stroke.id}
          points={toPoints(stroke.points)}
          pathLength={1}
          className={`lesson-stroke tier-${stroke.tier}`}
          style={{ '--delay': `${i * stepMs}ms` } as CSSProperties}
        />
      ))}
      {strokes.map((stroke, i) => (i % numberEvery === 0 && stroke.points.length > 0 ? (
        <g key={`n-${stroke.id}`} className={`lesson-badge tier-${stroke.tier}`} style={{ '--delay': `${i * stepMs}ms` } as CSSProperties}>
          <circle cx={stroke.points[0][0]} cy={stroke.points[0][1]} r={13} />
          <text x={stroke.points[0][0]} y={stroke.points[0][1]}>{i + 1}</text>
        </g>
      ) : null))}
    </svg>
  )
}
