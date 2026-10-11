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

  it('has the real engine hand every call to the mock for now', () => {
    for (const method of METHODS) expect(typeof realEngine[method]).toBe('function')
    const analysis = realEngine.analyze(foxPack, drawing(99))
    expect(realEngine.score(analysis)).toEqual(mockEngine.score(analysis))
  })
})
