// Pure helpers for the drawing canvas: screen pixels -> 768 target space, and strokes -> SVG paths.
import { getStroke } from 'perfect-freehand'
import type { Point, TimedPoint } from '../engine/types'

export const TARGET_SIZE = 768

// Only the parts of a DOMRect we use, so tests can pass a plain object.
export type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

// Turns a pointer position on screen into 768 x 768 target space. The canvas can be drawn at any size,
// so we scale by how big it is on screen right now. Points outside the canvas are pulled back to its edge.
export function toTargetPoint(clientX: number, clientY: number, rect: Rect): Point {
  const clamp = (n: number) => Math.min(TARGET_SIZE, Math.max(0, n))
  const x = ((clientX - rect.left) / rect.width) * TARGET_SIZE
  const y = ((clientY - rect.top) / rect.height) * TARGET_SIZE
  // One decimal is plenty of precision and keeps exported strokes small.
  return [Math.round(clamp(x) * 10) / 10, Math.round(clamp(y) * 10) / 10]
}

// perfect-freehand turns the centre line of a stroke into the outline of a smooth, pressure-sensitive ink shape.
// Sizes are in target space, so a stroke looks the same at any canvas size.
// Three pen sizes the user can pick, as the ink width in target space.
export const PEN_SIZES = { fine: 5, medium: 8, bold: 14 } as const
export type PenSize = keyof typeof PEN_SIZES

const INK = {
  size: PEN_SIZES.medium,
  thinning: 0.5,         // how much pressure changes the width
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false, // we pass real pen pressure, or a constant 0.5 for mouse and touch
}

// An SVG path for a stroke. `last` is true once the stroke is finished, which rounds off its end.
// `size` is the ink width in target space (one of PEN_SIZES).
export function strokeToPath(points: TimedPoint[], last = true, size: number = INK.size): string {
  if (points.length === 0) return ''
  // getStroke wants [x, y, pressure]; the 4th value (time) is dropped.
  const outline = getStroke(points.map(([x, y, pressure]) => [x, y, pressure]), { ...INK, size, last })
  return outlineToPath(outline)
}

// Joins outline points into a closed path of quadratic curves through the midpoints between them.
// This is the getSvgPathFromStroke helper from the perfect-freehand README.
function outlineToPath(outline: number[][]): string {
  if (outline.length < 4) return ''
  const average = (a: number, b: number) => (a + b) / 2
  const fixed = (n: number) => n.toFixed(2)
  const [a, b, c] = outline
  let path = `M${fixed(a[0])},${fixed(a[1])} Q${fixed(b[0])},${fixed(b[1])} ${fixed(average(b[0], c[0]))},${fixed(average(b[1], c[1]))} T`
  for (let i = 2; i < outline.length - 1; i++) {
    const p = outline[i]
    const q = outline[i + 1]
    path += `${fixed(average(p[0], q[0]))},${fixed(average(p[1], q[1]))} `
  }
  return path + 'Z'
}

// A polyline's points as an SVG "points" attribute: "x,y x,y ...".
export const toSvgPoints = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')

// Should this pointer be ignored? Once a pen has touched the canvas, touches are almost always the
// hand resting on the screen (palm), so they are ignored until the page reloads.
export function isPalm(pointerType: string, penSeen: boolean): boolean {
  return penSeen && pointerType === 'touch'
}
