import { describe, expect, it } from 'vitest'
import { strokeToPath, toTargetPoint } from '../geometry'

describe('toTargetPoint', () => {
  // A canvas shown 384 px wide, 100 px from the left and 50 px from the top of the page.
  const rect = { left: 100, top: 50, width: 384, height: 384 }

  it('scales screen pixels to 768 x 768 target space', () => {
    expect(toTargetPoint(100, 50, rect)).toEqual([0, 0])
    expect(toTargetPoint(292, 242, rect)).toEqual([384, 384]) // the centre
    expect(toTargetPoint(484, 434, rect)).toEqual([768, 768])
  })

  it('pulls points outside the canvas back to its edge', () => {
    expect(toTargetPoint(0, 1000, rect)).toEqual([0, 768])
  })
})

describe('strokeToPath', () => {
  it('turns a stroke into a closed SVG path', () => {
    const path = strokeToPath([[10, 10, 0.5, 0], [60, 40, 0.5, 16], [120, 50, 0.5, 32]])
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('gives an empty path for an empty stroke', () => {
    expect(strokeToPath([])).toBe('')
  })
})
