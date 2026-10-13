import { describe, expect, it } from 'vitest'
import type { LiveErrorKind } from '../../lib/live'
import { REDRAW_FAILED, redrawApology, redrawNote } from '../redraw'

describe('"Draw a new one" wording', () => {
  it('apologises, and mentions the photo when the lesson came from one', () => {
    expect(redrawApology(false)).toMatch(/^Sorry/)
    expect(redrawApology(true)).toMatch(/photo/)
    expect(redrawApology(false)).not.toMatch(/photo/)
  })

  it('says which drawing this is once there has been more than one', () => {
    expect(redrawNote(1)).not.toMatch(/drawing \d/)
    expect(redrawNote(2)).toMatch(/This is drawing 2\./)
    expect(redrawNote(5)).toMatch(/This is drawing 5\./)
  })

  it('has a friendly message for every way generation can fail, never a raw error', () => {
    const kinds: LiveErrorKind[] = ['offline', 'timeout', 'busy', 'rejected', 'failed']
    for (const kind of kinds) {
      expect(REDRAW_FAILED[kind]).toBeTruthy()
      expect(REDRAW_FAILED[kind]).not.toMatch(/HTTP|Error|undefined/)
    }
  })
})
