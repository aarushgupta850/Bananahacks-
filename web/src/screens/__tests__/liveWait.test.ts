import { describe, expect, it } from 'vitest'
import { liveWaitText } from '../liveWait'

describe('liveWaitText', () => {
  it('changes as the wait gets longer, and says so when someone else is first', () => {
    expect(liveWaitText(0, false)).toMatch(/20 to 40 seconds/)
    expect(liveWaitText(30, false)).toMatch(/Checking the drafts/)
    expect(liveWaitText(70, false)).toMatch(/draws again/)
    expect(liveWaitText(70, true)).toMatch(/Someone else/)
  })
})
