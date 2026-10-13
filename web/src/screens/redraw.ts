// Words for "Draw a new one" on the Reference screen, for lessons that live AI made from a typed subject or a photo.
// Kept apart from the screen so they can be tested.
import type { LiveErrorKind } from '../lib/live'

// The apology shown under every live drawing: image AI sometimes draws something hard to copy (stray lines, two
// subjects, a cut-off shape), so the user can always ask for another drawing of the same thing.
export function redrawApology(fromPhoto: boolean): string {
  return fromPhoto
    ? 'Sorry if this drawing doesn’t match your photo or looks hard to copy. Image AI doesn’t always get it right.'
    : 'Sorry if this drawing looks off or hard to copy. Image AI doesn’t always get it right.'
}

// The small note under the button. After a redraw it says which drawing this is, so it's clear something changed.
export function redrawNote(drawings: number): string {
  const time = 'Same subject, a fresh drawing, in about 20 seconds.'
  return drawings <= 1 ? time : `This is drawing ${drawings}. ${time}`
}

// When a new drawing fails, the current one stays: say so, and what to do next.
export const REDRAW_FAILED: Record<LiveErrorKind, string> = {
  offline: 'Live AI is offline right now, so we can’t draw a new one. You can use this drawing or choose another subject.',
  timeout: 'The new drawing took too long. Try again in a moment, or use this one.',
  busy: 'The AI is busy drawing for someone else. Try again in a moment, or use this one.',
  rejected: 'We couldn’t draw that one again. Use this drawing, or choose another subject.',
  failed: 'Something went wrong making a new drawing. Try again, or use this one.',
}
