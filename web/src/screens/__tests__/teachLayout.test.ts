/// <reference types="node" />
// The lesson's layout must never move the canvas while the user draws. Everything that changes after a stroke
// (the step text, "Stuck?", "Lesson complete", the toast and the "Step done" chip) either has a fixed size or
// floats over the canvas. These read the CSS itself, so a later style change that brings the jump back fails here.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The style sheets as text, read from disk. (Importing a .css file with "?raw" gives an empty string under
// vitest, whose CSS handling is off.)
const sheet = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const canvasCss = sheet('../../canvas/canvas.css')
const globalCss = sheet('../../styles/global.css')
const screensCss = sheet('../../styles/screens.css')

// The declarations of the first rule whose selector is exactly `selector` (comments removed).
function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(clean)
  if (!match) throw new Error(`no rule for ${selector}`)
  return match[2]
}

describe('the lesson layout never shifts the canvas', () => {
  it('the step box above the canvas has a fixed height, and its texts are clipped to it', () => {
    const step = rule(screensCss, '.teach-step')
    expect(step).toMatch(/(^|[;\s])height:/)
    expect(step).not.toMatch(/min-height/)
    expect(step).toMatch(/overflow:\s*hidden/)
    expect(rule(screensCss, '.teach-step h2')).toMatch(/white-space:\s*nowrap/)
    expect(rule(screensCss, '.teach-step p')).toMatch(/line-clamp:\s*3/)
  })

  it('messages over the canvas float (absolute) and never catch the pen', () => {
    for (const selector of ['.teach-toast', '.teach-cheer', '.teach-redrawing']) {
      const css = rule(screensCss, selector)
      expect(css, selector).toMatch(/position:\s*absolute/)
      expect(css, selector).toMatch(/pointer-events:\s*none/)
    }
    for (const selector of ['.ghost-swap']) expect(rule(screensCss, selector)).toMatch(/position:\s*absolute/)
    expect(rule(canvasCss, '.ghost-layer')).toMatch(/position:\s*absolute/)
  })

  it('a scrollbar appearing never narrows the page', () => {
    expect(rule(globalCss, 'html')).toMatch(/scrollbar-gutter:\s*stable/)
  })

  it('the "Step done" chip keeps its centring while it animates in', () => {
    expect(rule(screensCss, '.teach-cheer')).toMatch(/animation:\s*cheer-in/)
    expect(screensCss).toMatch(/@keyframes cheer-in\s*\{[^}]*translate\(-50%/)
  })

  it('the trace glides on the same curve and for the same time as the guides', () => {
    expect(rule(screensCss, '.trace-move')).toMatch(/transition:\s*transform 300ms cubic-bezier\(0\.33, 1, 0\.68, 1\)/)
  })
})
