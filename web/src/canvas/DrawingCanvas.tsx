// The drawing surface. Works with mouse, touch and stylus through pointer events, and reports each finished
// stroke as a UserStroke in 768 x 768 target space ([x, y, pressure, ms since stroke start], see types.ts).
// The parent owns the list of strokes, so undo and clear are just "drop the last one" and "empty the list"
// (CanvasToolbar has the buttons). SVG keeps lines sharp on high-DPI screens at any size.
import { useRef, useState, type PointerEvent } from 'react'
import type { TimedPoint, UserStroke } from '../engine/types'
import { isPalm, PEN_SIZES, strokeToPath, TARGET_SIZE, toTargetPoint, type PenSize } from './geometry'
import './canvas.css'

interface DrawingCanvasProps {
  strokes: UserStroke[]                    // finished strokes to show
  onStroke?: (stroke: UserStroke) => void  // called once per finished stroke
  readOnly?: boolean
  penSize?: PenSize                        // the size new strokes are drawn with
  label?: string                           // accessible name, e.g. "Your test drawing"
}

// Which pen size each stroke was drawn with. Keyed by the stroke object itself, so it stays right
// when the parent undoes or clears strokes, and it never leaks into the UserStroke the engine sees.
const strokeSizes = new WeakMap<UserStroke, number>()

// Mouse and touch have no real pressure, so they get a constant middle value (a steady line).
function pressureOf(e: PointerEvent): number {
  return e.pointerType === 'pen' ? e.pressure : 0.5
}

export default function DrawingCanvas({ strokes, onStroke, readOnly = false, penSize = 'medium', label }: DrawingCanvasProps) {
  // The stroke being drawn lives in a ref (so pointer handlers always see the latest points)
  // and is copied into state to re-render.
  const current = useRef<{ pointerId: number; start: number; points: TimedPoint[] } | null>(null)
  const penSeen = useRef(false) // palm rejection: set once a stylus touches the canvas
  const [livePoints, setLivePoints] = useState<TimedPoint[] | null>(null)
  const size = PEN_SIZES[penSize]

  function pointAt(e: PointerEvent<SVGSVGElement>, start: number): TimedPoint {
    const [x, y] = toTargetPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
    return [x, y, pressureOf(e), Math.round(e.timeStamp - start)]
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'pen') penSeen.current = true
    if (isPalm(e.pointerType, penSeen.current)) return
    // Only the main button, and only one stroke at a time (a second finger is ignored).
    if (e.button !== 0 || current.current) return
    // Capture keeps the stroke going even if the pointer leaves the canvas.
    e.currentTarget.setPointerCapture(e.pointerId)
    current.current = { pointerId: e.pointerId, start: e.timeStamp, points: [pointAt(e, e.timeStamp)] }
    setLivePoints(current.current.points)
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    // A pen hovering above an iPad also sends moves; only the pointer that started the stroke counts.
    const stroke = current.current
    if (!stroke || e.pointerId !== stroke.pointerId) return
    // Fast pens send several samples per frame; the browser batches them as coalesced events.
    // Using them all keeps quick curves smooth instead of turning them into straight segments.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
    const rect = e.currentTarget.getBoundingClientRect()
    const added: TimedPoint[] = samples.length > 1
      ? samples.map((s) => {
        const [x, y] = toTargetPoint(s.clientX, s.clientY, rect)
        return [x, y, s.pointerType === 'pen' ? s.pressure : 0.5, Math.round(s.timeStamp - stroke.start)]
      })
      : [pointAt(e, stroke.start)]
    stroke.points = [...stroke.points, ...added]
    setLivePoints(stroke.points)
  }

  function handlePointerEnd(e: PointerEvent<SVGSVGElement>) {
    const stroke = current.current
    if (!stroke || e.pointerId !== stroke.pointerId) return
    current.current = null
    setLivePoints(null)
    const finished: UserStroke = { points: stroke.points }
    strokeSizes.set(finished, size)
    // Reported straight from the event handler, never from inside a state update
    // (React StrictMode runs those twice, which would report the stroke twice).
    onStroke?.(finished)
  }

  const handlers = readOnly
    ? {}
    : {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerEnd,
        onPointerCancel: handlePointerEnd,
      }

  return (
    <svg
      className={readOnly ? 'drawing-canvas is-readonly' : 'drawing-canvas'}
      viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`}
      role="img"
      aria-label={label ?? (readOnly ? 'Your drawing' : 'Drawing canvas. Draw here with a mouse, finger or stylus.')}
      {...handlers}
    >
      {strokes.map((stroke, i) => (
        <path key={i} d={strokeToPath(stroke.points, true, strokeSizes.get(stroke) ?? PEN_SIZES.medium)} />
      ))}
      {livePoints && <path d={strokeToPath(livePoints, false, size)} />}
    </svg>
  )
}
