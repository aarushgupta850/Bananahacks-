import { describe, expect, it, vi } from 'vitest'
import { mockEngine } from '../mock'
import { realEngine } from '../real'
import { drawing, foxPack } from './fixtures'

const METHODS = ['analyze', 'findWeaknesses', 'buildLesson', 'createTeacher', 'score', 'coach'] as const

describe('engine switch', () => {
  it('exports a complete engine and says which one is active', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { engine } = await import('../index')
    for (const method of METHODS) expect(typeof engine[method]).toBe('function')
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/using the (mock|real) engine/))
    info.mockRestore()
  })

  it('has a complete real engine that no longer uses the mock', () => {
    for (const method of METHODS) expect(typeof realEngine[method]).toBe('function')
    // The mock never aligns strokes; the real engine moves them into the target's frame.
    const strokes = drawing(99)
    const analysis = realEngine.analyze(foxPack, strokes)
    expect(analysis.alignedStrokes).toHaveLength(strokes.length)
    expect(analysis.alignedStrokes).not.toEqual(mockEngine.analyze(foxPack, strokes).alignedStrokes)
    const { total } = realEngine.score(analysis)
    expect(total).toBeGreaterThanOrEqual(0)
    expect(total).toBeLessThanOrEqual(100)
  })
})
