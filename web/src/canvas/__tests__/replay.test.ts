import { describe, expect, it } from 'vitest'
import type { Ghost, UserStroke } from '../../engine/types'
import type { TeachRecording } from '../../session'
import { isPalm } from '../geometry'
import { frameAt, recordingLength } from '../replay'

// A stroke that took 100 ms to draw, ending at t = 1000.
const stroke: UserStroke = { points: [[0, 0, 0.5, 0], [10, 10, 0.5, 50], [20, 20, 0.5, 100]] }
const ghosts: Ghost[] = [{ strokeId: 's1', kind: 'stroke', points: [[0, 0], [5, 5]] }]
const recording: TeachRecording = {
  events: [{ t: 1000, type: 'stroke', stroke }, { t: 1000, type: 'ghosts', ghosts }],
}

describe('frameAt', () => {
  it('shows nothing before the stroke started', () => {
    expect(frameAt(recording, 800)).toEqual({ strokes: [], ghosts: [] })
  })

  it('shows only the points drawn so far while a stroke is in progress', () => {
    const { strokes } = frameAt(recording, 950) // 50 ms into the stroke
    expect(strokes[0].points).toHaveLength(2)
  })

  it('shows the finished stroke and the ghosts after it', () => {
    expect(frameAt(recording, 1000)).toEqual({ strokes: [stroke], ghosts })
  })
})

describe('recordingLength', () => {
  it('is 0 for an empty recording and adds a pause after the last event', () => {
    expect(recordingLength({ events: [] })).toBe(0)
    expect(recordingLength(recording)).toBe(1500)
  })
})

describe('isPalm', () => {
  it('ignores touches only after a pen has been seen', () => {
    expect(isPalm('touch', false)).toBe(false)
    expect(isPalm('touch', true)).toBe(true)
    expect(isPalm('pen', true)).toBe(false)
    expect(isPalm('mouse', true)).toBe(false)
  })
})
