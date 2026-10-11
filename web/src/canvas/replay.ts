// Pure helpers for ReplayPlayer: what the canvas shows at a given moment of a recorded lesson.
import type { Ghost, UserStroke } from '../engine/types'
import type { TeachRecording } from '../session'

export const REPLAY_SPEED = 4

// How long a stroke took to draw: the time of its last point.
const durationOf = (stroke: UserStroke) => stroke.points[stroke.points.length - 1]?.[3] ?? 0

// What the canvas shows `elapsed` ms into the recording (in recording time, not screen time).
// Exported for the tests. Stroke events are logged when a stroke ends, so a stroke started `duration`
// earlier; while it is in progress only the points drawn so far are shown.
export function frameAt(recording: TeachRecording, elapsed: number): { strokes: UserStroke[]; ghosts: Ghost[] } {
  const strokes: UserStroke[] = []
  let ghosts: Ghost[] = []
  for (const event of recording.events) {
    if (event.type === 'stroke' && event.stroke) {
      const start = event.t - durationOf(event.stroke)
      if (elapsed >= event.t) strokes.push(event.stroke)
      else if (elapsed >= start) strokes.push({ points: event.stroke.points.filter((p) => p[3] <= elapsed - start) })
    } else if (event.type === 'ghosts' && event.ghosts && elapsed >= event.t) {
      ghosts = event.ghosts
    }
  }
  return { strokes, ghosts }
}

// The length of a recording: the last event, plus a moment at the end so the finished drawing is seen.
export function recordingLength(recording: TeachRecording): number {
  const last = recording.events[recording.events.length - 1]
  return last ? last.t + 500 : 0
}

