// The drawing surface. Works with mouse, touch and stylus through pointer events, and reports each finished
// stroke as a UserStroke in 768 x 768 target space ([x, y, pressure, ms since stroke start], see types.ts).
// The parent owns the list of strokes (useStrokeHistory gives it undo; CanvasToolbar has the buttons).
// With the eraser tool, dragging rubs out parts of lines instead of drawing: the canvas previews the result
// while the pointer is down and reports the new list once, through onErase, when the gesture ends.
// SVG keeps lines sharp on high-DPI screens at any size.
import { useRef, useState, type PointerEvent } from 'react'
import type { Point, TimedPoint, UserStroke } from '../engine/types'
import { ERASER_RADIUS, eraseAlong } from './erase'
import { isPalm, PEN_SIZES, strokeToPath, TARGET_SIZE, toTargetPoint, type PenSize } from './geometry'
import './canvas.css'

export type Tool = 'pen' | 'eraser'

interface DrawingCanvasProps {
  strokes: UserStroke[]                    // finished strokes to show
  onStroke?: (stroke: UserStroke) => void  // called once per finished stroke
  readOnly?: boolean
  penSize?: PenSize                        // the size new strokes are drawn with
  tool?: Tool                              // 'eraser' makes dragging erase instead of draw
  onErase?: (next: UserStroke[]) => void   // called once per eraser gesture that removed something
  label?: string                           // accessible name, e.g. "Your test drawing"
}

// Which pen size each stroke was drawn with. Keyed by the stroke object itself, so it stays right
// when the parent undoes or clears strokes, and it never leaks into the UserStroke the engine sees.
const strokeSizes = new WeakMap<UserStroke, number>()

// The eraser splits a stroke into new piece objects; each piece keeps the size of the stroke it came from.
function rememberSplit(original: UserStroke, pieces: UserStroke[]) {
  const size = strokeSizes.get(original)
  if (size !== undefined) for (const piece of pieces) strokeSizes.set(piece, size)
}

// Mouse and touch have no real pressure, so they get a constant middle value (a steady line).
function pressureOf(e: PointerEvent): number {
  return e.pointerType === 'pen' ? e.pressure : 0.5
}

export default function DrawingCanvas({
  strokes, onStroke, readOnly = false, penSize = 'medium', tool = 'pen', onErase, label,
}: DrawingCanvasProps) {
  // The stroke being drawn lives in a ref (so pointer handlers always see the latest points)
  // and is copied into state to re-render.
  const current = useRef<{ pointerId: number; start: number; points: TimedPoint[] } | null>(null)
  const penSeen = useRef(false) // palm rejection: set once a stylus touches the canvas
  const [livePoints, setLivePoints] = useState<TimedPoint[] | null>(null)
  const size = PEN_SIZES[penSize]

  // An eraser gesture in progress: its pointer, where it was last, and the strokes as erased so far.
  // The parent's list is only replaced when the gesture ends, so one drag is one undo step.
  const erasing = useRef<{ pointerId: number; last: Point; strokes: UserStroke[] } | null>(null)
  const [erasedPreview, setErasedPreview] = useState<UserStroke[] | null>(null)
  // Where the eraser circle is drawn (also while a mouse just hovers, so you can see what it will hit).
  const [eraserAt, setEraserAt] = useState<Point | null>(null)
  const isEraser = tool === 'eraser'

  function pointAt(e: PointerEvent<SVGSVGElement>, start: number): TimedPoint {
    const [x, y] = toTargetPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
    return [x, y, pressureOf(e), Math.round(e.timeStamp - start)]
  }

  // Erases along `path` (from where the eraser was to where it is now) and shows the result.
  function eraseTo(at: Point, path: Point[]) {
    const gesture = erasing.current
    if (!gesture) return
    gesture.strokes = eraseAlong(gesture.strokes, path, ERASER_RADIUS, rememberSplit)
    gesture.last = at
    setErasedPreview(gesture.strokes)
    setEraserAt(at)
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'pen') penSeen.current = true
    if (isPalm(e.pointerType, penSeen.current)) return
    // Only the main button, and only one stroke (or eraser drag) at a time (a second finger is ignored).
    if (e.button !== 0 || current.current || erasing.current) return
    // Capture keeps the stroke going even if the pointer leaves the canvas.
    e.currentTarget.setPointerCapture(e.pointerId)
    if (isEraser) {
      const [x, y] = pointAt(e, e.timeStamp)
      erasing.current = { pointerId: e.pointerId, last: [x, y], strokes }
      eraseTo([x, y], [[x, y]]) // a tap erases too
      return
    }
    current.current = { pointerId: e.pointerId, start: e.timeStamp, points: [pointAt(e, e.timeStamp)] }
    setLivePoints(current.current.points)
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (isEraser) {
      handleEraserMove(e)
      return
    }
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

  function handleEraserMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const gesture = erasing.current
    if (!gesture) {
      // Just hovering (a mouse, or a pen above an iPad): move the circle, erase nothing.
      if (!isPalm(e.pointerType, penSeen.current)) setEraserAt(toTargetPoint(e.clientX, e.clientY, rect))
      return
    }
    if (e.pointerId !== gesture.pointerId) return
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
    const moved = samples.length > 1
      ? samples.map((s) => toTargetPoint(s.clientX, s.clientY, rect))
      : [toTargetPoint(e.clientX, e.clientY, rect)]
    // Only the new part of the drag is erased each time, so a long drag stays fast.
    eraseTo(moved[moved.length - 1], [gesture.last, ...moved])
  }

  function handlePointerEnd(e: PointerEvent<SVGSVGElement>) {
    const gesture = erasing.current
    if (gesture) {
      if (e.pointerId !== gesture.pointerId) return
      erasing.current = null
      setErasedPreview(null)
      if (e.pointerType !== 'mouse') setEraserAt(null) // a finger or pen left the screen: hide the circle
      // eraseAlong hands back the very same list when it removed nothing, so a miss is not an undo step.
      if (gesture.strokes !== strokes) onErase?.(gesture.strokes)
      return
    }
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
        onPointerLeave: () => { if (!erasing.current) setEraserAt(null) },
      }

  const shown = erasedPreview ?? strokes // mid-gesture, the eraser's preview; otherwise the parent's list
  const showEraser = !readOnly && isEraser && eraserAt !== null
  const className = readOnly ? 'drawing-canvas is-readonly' : isEraser ? 'drawing-canvas is-erasing' : 'drawing-canvas'

  return (
    <svg
      className={className}
      viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`}
      role="img"
      aria-label={label ?? (readOnly ? 'Your drawing' : 'Drawing canvas. Draw here with a mouse, finger or stylus.')}
      {...handlers}
    >
      {shown.map((stroke, i) => (
        <path key={i} d={strokeToPath(stroke.points, true, strokeSizes.get(stroke) ?? PEN_SIZES.medium)} />
      ))}
      {livePoints && <path d={strokeToPath(livePoints, false, size)} />}
      {/* The eraser's reach, as a soft circle under the pointer. A <circle>, not a <path>, so it never reads as ink. */}
      {showEraser && <circle className="eraser-cursor" cx={eraserAt[0]} cy={eraserAt[1]} r={ERASER_RADIUS} />}
    </svg>
  )
}
