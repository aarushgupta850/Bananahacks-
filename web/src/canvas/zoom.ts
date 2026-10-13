// Zooming the drawing canvas in and out: two fingers pinch to zoom and drag to pan (touch screens), a trackpad pinch
// or Ctrl + scroll zooms, and scrolling pans while zoomed in (laptops). This file is only the arithmetic, so it can
// be tested; ZoomStack.tsx applies it as a CSS transform to the canvas and the layers above it.
//
// Everything is in "box units": 0 to 1 across the canvas box, so a view stays right when the window is resized.
// The canvas is drawn scaled by `scale` and moved by (x, y) from the box's top-left corner. The strokes themselves are
// never changed: DrawingCanvas reads pointer positions from the transformed canvas, so ink lands where the finger is.

export type BoxPoint = [number, number]

export interface View {
  scale: number // 1 = whole drawing visible, MAX_ZOOM = the most zoomed in
  x: number     // where the canvas's top-left corner is, in box units (0 or less: it's never moved past the edge)
  y: number
}

export const IDENTITY: View = { scale: 1, x: 0, y: 0 }
export const MAX_ZOOM = 4

// Keeps the view inside sensible limits: between 1x and MAX_ZOOM, and never moved so far that an empty edge shows.
export function clampView(view: View): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale))
  const clamp = (n: number) => Math.min(0, Math.max(1 - scale, n))
  return { scale, x: clamp(view.x), y: clamp(view.y) }
}

// Zooms by `factor` around `at` (the point under the cursor or between the fingers stays where it is).
export function zoomAt(view: View, at: BoxPoint, factor: number): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale * factor))
  // The canvas point under `at` before zooming, which must stay under `at` after.
  const cx = (at[0] - view.x) / view.scale
  const cy = (at[1] - view.y) / view.scale
  return clampView({ scale, x: at[0] - cx * scale, y: at[1] - cy * scale })
}

// Moves the view by (dx, dy) box units (a two-finger scroll on a trackpad while zoomed in).
export function panBy(view: View, dx: number, dy: number): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy })
}

// Where a pinch started: the view then, and the two fingers.
export interface PinchStart {
  view: View
  a: BoxPoint
  b: BoxPoint
}

const distance = (a: BoxPoint, b: BoxPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])
const middle = (a: BoxPoint, b: BoxPoint): BoxPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

// The view while two fingers move: spreading them zooms in, pinching zooms out, and moving both drags the drawing.
// The canvas point that was between the fingers at the start stays between them.
export function pinchView(start: PinchStart, a: BoxPoint, b: BoxPoint): View {
  const before = distance(start.a, start.b)
  const factor = before > 0 ? distance(a, b) / before : 1
  const scale = Math.min(MAX_ZOOM, Math.max(1, start.view.scale * factor))
  const [m0x, m0y] = middle(start.a, start.b)
  const [mx, my] = middle(a, b)
  const cx = (m0x - start.view.x) / start.view.scale
  const cy = (m0y - start.view.y) / start.view.scale
  return clampView({ scale, x: mx - cx * scale, y: my - cy * scale })
}

// The CSS transform for a view (translate in % of the box, then scale from the top-left corner).
export function viewTransform(view: View): string {
  return `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})`
}

export const isZoomed = (view: View) => view.scale > 1.001
