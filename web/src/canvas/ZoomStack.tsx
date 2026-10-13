// The drawing area (.canvas-stack) with zoom: everything in `children` (the canvas, the trace, the ghost lines) is
// zoomed and moved together, while `overlay` (messages like "Step done") stays put on top.
// - Touch screens: two fingers pinch to zoom and drag to move. DrawingCanvas spots the second finger (it already
//   tracks pointers for drawing) and drives the pinch through the context below.
// - Laptops: a trackpad pinch (which browsers send as Ctrl + scroll) zooms at the cursor; while zoomed in, scrolling
//   moves the drawing instead of the page.
// "Reset zoom" appears whenever the drawing is zoomed in.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clampView, IDENTITY, isZoomed, panBy, pinchView, viewTransform, zoomAt, type BoxPoint, type View } from './zoom'
import { ZoomContext, type ZoomControls } from './zoomContext'

const WHEEL_ZOOM_SPEED = 0.01 // how much one unit of Ctrl + scroll zooms (a trackpad pinch sends many small ones)

export default function ZoomStack({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(IDENTITY)
  const latest = useRef(view) // for the pinch and the wheel, which start from the view as it is right now
  useEffect(() => {
    latest.current = view
  }, [view])

  // Screen position -> box units (0 to 1 across the box, which is never transformed itself).
  const toBox = ([clientX, clientY]: [number, number]): BoxPoint => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return [0.5, 0.5]
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height]
  }

  const controls = useMemo<ZoomControls>(() => ({
    startPinch: (a, b) => ({ view: latest.current, a: toBox(a), b: toBox(b) }),
    movePinch: (start, a, b) => setView(pinchView(start, toBox(a), toBox(b))),
  }), [])

  // Trackpad pinch and scroll. React's onWheel can't cancel the page's own zoom or scroll (it's passive), so this is
  // a native listener.
  useEffect(() => {
    const element = box.current
    if (!element) return
    function onWheel(e: WheelEvent) {
      const now = latest.current
      if (e.ctrlKey) {
        e.preventDefault() // a pinch zooms the drawing, not the whole page
        setView(zoomAt(now, toBox([e.clientX, e.clientY]), Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED)))
      } else if (isZoomed(now)) {
        e.preventDefault() // while zoomed in, scrolling moves around the drawing
        const rect = element!.getBoundingClientRect()
        setView(panBy(now, -e.deltaX / rect.width, -e.deltaY / rect.height))
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const zoomed = isZoomed(view)
  return (
    <div ref={box} className="canvas-stack">
      <ZoomContext.Provider value={controls}>
        <div className={zoomed ? 'zoom-layer is-zoomed' : 'zoom-layer'} style={{ transform: viewTransform(clampView(view)) }}>
          {children}
        </div>
      </ZoomContext.Provider>
      {overlay}
      {zoomed && (
        <button type="button" className="zoom-reset" onClick={() => setView(IDENTITY)}>
          Reset zoom <span className="zoom-level">{Math.round(view.scale * 100)}%</span>
        </button>
      )}
    </div>
  )
}
