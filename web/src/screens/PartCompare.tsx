// A small picture comparing where a part should be (the target's box, dashed) with where the user drew it
// (their box, solid). Both boxes are also labeled in text ("target", "yours"), so color is never the only signal.
// Coordinates are in 768 target space; the view zooms to the two boxes with some margin.
import type { Box } from '../engine/types'

interface PartCompareProps {
  target: Box | null      // the pack's box for the part
  user: Box | null        // the user's box from the engine's analysis (null when the part is missing)
  label: string           // e.g. "head"
}

const MARGIN = 40

// The smallest square around every box given, plus a margin, as an SVG viewBox.
function viewAround(boxes: Box[]): string {
  if (boxes.length === 0) return '0 0 768 768'
  const left = Math.min(...boxes.map((b) => b[0]))
  const top = Math.min(...boxes.map((b) => b[1]))
  const right = Math.max(...boxes.map((b) => b[0] + b[2]))
  const bottom = Math.max(...boxes.map((b) => b[1] + b[3]))
  const side = Math.max(right - left, bottom - top) + 2 * MARGIN
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  return `${cx - side / 2} ${cy - side / 2} ${side} ${side}`
}

export default function PartCompare({ target, user, label }: PartCompareProps) {
  const boxes = [target, user].filter((b): b is Box => b !== null)
  const view = viewAround(boxes)
  const side = Number(view.split(' ')[2])
  const fontSize = side / 11 // labels stay the same size on screen however far the view zooms
  return (
    <svg className="part-compare" viewBox={view} role="img" aria-label={describe(target, user, label)}>
      {target && (
        <g className="compare-target">
          <rect x={target[0]} y={target[1]} width={target[2]} height={target[3]} vectorEffect="non-scaling-stroke" />
          <text x={target[0] + 6} y={target[1] + target[3] - 8} fontSize={fontSize}>target</text>
        </g>
      )}
      {user && (
        <g className="compare-user">
          <rect x={user[0]} y={user[1]} width={user[2]} height={user[3]} vectorEffect="non-scaling-stroke" />
          <text x={user[0] + 8} y={user[1] + fontSize * 1.15} fontSize={fontSize}>yours</text>
        </g>
      )}
    </svg>
  )
}

function describe(target: Box | null, user: Box | null, label: string): string {
  if (target && !user) return `Where the ${label} should be. It is missing from your drawing.`
  return `Your ${label} compared with the target's ${label}`
}
