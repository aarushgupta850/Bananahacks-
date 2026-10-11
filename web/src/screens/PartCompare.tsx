// A small zoomed-in picture of one part: the target drawing faint in gray for context, the part itself
// in thick accent lines, and the user's own drawing (aligned by the engine) in thin ink on top.
// A legend under it names each kind of line, so color is never the only signal.
// Coordinates are in 768 target space; the view zooms to the part (and where the user drew it) with room around.
import { toSvgPoints } from '../canvas/geometry'
import type { Box, Pack, Point, UserStroke } from '../engine/types'

interface PartCompareProps {
  pack: Pack
  partId: string
  user: Box | null        // where the user drew the part, from the engine's analysis (null when missing)
  yours: UserStroke[]     // the user's strokes, aligned to the target by the engine
  label: string           // e.g. "door"
}

// The smallest square around every box given, with room around it, as [x, y, side].
function viewAround(boxes: Box[]): [number, number, number] {
  if (boxes.length === 0) return [0, 0, 768]
  const left = Math.min(...boxes.map((b) => b[0]))
  const top = Math.min(...boxes.map((b) => b[1]))
  const right = Math.max(...boxes.map((b) => b[0] + b[2]))
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]))
  const size = Math.max(right - left, bottom - top)
  // Show about a part's width of the drawing around it, so you can see where it sits (at least 80 px).
  const side = size + 2 * Math.max(80, 0.5 * size)
  return [(left + right) / 2 - side / 2, (top + bottom) / 2 - side / 2, side]
}

const line = (points: Point[], className: string, key: string | number) => (
  <polyline key={key} className={className} points={toSvgPoints(points)} vectorEffect="non-scaling-stroke" />
)

export default function PartCompare({ pack, partId, user, yours, label }: PartCompareProps) {
  const target = pack.parts.find((p) => p.id === partId)?.box ?? null
  const drawn = pack.strokes.filter((s) => s.tier !== 'construction')
  const partLines = drawn.filter((s) => s.partId === partId)
  const [x, y, side] = viewAround([target, user].filter((b): b is Box => b !== null))
  const missing = user === null

  return (
    <figure className="part-compare-figure">
      <svg className="part-compare" viewBox={`${x} ${y} ${side} ${side}`} role="img"
        aria-label={missing ? `Where the ${label} goes. It is missing from your drawing.` : `Your ${label} compared with the target's ${label}`}>
        {/* The whole target, faint, for context. */}
        {drawn.filter((s) => s.partId !== partId).map((s) => line(s.points, 'compare-context', s.id))}
        {/* The part to look at. A part without its own lines falls back to its box, dashed. */}
        {partLines.length > 0
          ? partLines.map((s) => line(s.points, 'compare-part', s.id))
          : target && <rect className="compare-part-box" x={target[0]} y={target[1]} width={target[2]} height={target[3]} vectorEffect="non-scaling-stroke" />}
        {/* What the user drew. */}
        {yours.map((s, i) => line(s.points.map(([px, py]): Point => [px, py]), 'compare-yours', i))}
      </svg>
      <figcaption className="compare-legend">
        <span><i className="legend-part" aria-hidden="true" />{missing ? `The ${label} you missed` : `The ${label}`}</span>
        <span><i className="legend-yours" aria-hidden="true" />Your drawing</span>
      </figcaption>
    </figure>
  )
}
