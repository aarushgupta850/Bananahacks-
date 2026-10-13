import { describe, expect, it } from 'vitest'
import { clampView, IDENTITY, isZoomed, MAX_ZOOM, panBy, pinchView, viewTransform, zoomAt } from '../zoom'

// Where a canvas point (0-1 across the drawing) ends up on screen (0-1 across the box) under a view.
const onScreen = (v: { scale: number; x: number; y: number }, p: [number, number]) => [v.x + p[0] * v.scale, v.y + p[1] * v.scale]

describe('canvas zoom', () => {
  it('spreading two fingers zooms in around the point between them', () => {
    const view = pinchView({ view: IDENTITY, a: [0.4, 0.5], b: [0.6, 0.5] }, [0.3, 0.5], [0.7, 0.5])
    expect(view.scale).toBeCloseTo(2)
    // The canvas point that was between the fingers (0.5, 0.5) is still between them.
    const [sx, sy] = onScreen(view, [0.5, 0.5])
    expect(sx).toBeCloseTo(0.5)
    expect(sy).toBeCloseTo(0.5)
  })

  it('moving both fingers together drags the zoomed drawing', () => {
    const zoomed = { scale: 2, x: -0.5, y: -0.5 }
    const view = pinchView({ view: zoomed, a: [0.4, 0.4], b: [0.6, 0.6] }, [0.5, 0.4], [0.7, 0.6])
    expect(view.scale).toBeCloseTo(2)
    expect(view.x).toBeCloseTo(-0.4)
    expect(view.y).toBeCloseTo(-0.5)
  })

  it('never zooms out past the whole drawing, or in past the limit', () => {
    expect(pinchView({ view: IDENTITY, a: [0.3, 0.5], b: [0.7, 0.5] }, [0.45, 0.5], [0.55, 0.5])).toEqual(IDENTITY)
    expect(zoomAt(IDENTITY, [0.5, 0.5], 100).scale).toBe(MAX_ZOOM)
  })

  it('never moves the drawing so far that an empty edge shows', () => {
    const zoomed = { scale: 2, x: -0.5, y: -0.5 }
    expect(panBy(zoomed, 5, 5)).toEqual({ scale: 2, x: 0, y: 0 })
    expect(panBy(zoomed, -5, -5)).toEqual({ scale: 2, x: -1, y: -1 })
    expect(clampView({ scale: 1, x: -0.3, y: 0.2 })).toEqual(IDENTITY)
  })

  it('zooming at a point keeps that point under the cursor', () => {
    const view = zoomAt(IDENTITY, [0.25, 0.75], 2)
    const [sx, sy] = onScreen(view, [0.25, 0.75])
    expect(sx).toBeCloseTo(0.25)
    expect(sy).toBeCloseTo(0.75)
  })

  it('writes the CSS transform and knows when it is zoomed', () => {
    expect(viewTransform({ scale: 2, x: -0.5, y: -0.25 })).toBe('translate(-50%, -25%) scale(2)')
    expect(isZoomed(IDENTITY)).toBe(false)
    expect(isZoomed({ scale: 1.5, x: 0, y: 0 })).toBe(true)
  })
})
