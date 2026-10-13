// Plays back a teaching session at 4x speed: the user's strokes draw themselves in again, and the ghosts change
// as they did live. The recording format is TeachRecording in session.ts: events with a time `t` (ms since the
// lesson started), either a finished 'stroke' or the 'ghosts' the teacher showed after it.
import { useEffect, useRef, useState } from 'react'
import type { Ghost } from '../engine/types'
import type { TeachRecording } from '../session'
import DrawingCanvas from './DrawingCanvas'
import GhostLayer from './GhostLayer'
import { frameAt, recordingLength, REPLAY_SPEED } from './replay'
import './canvas.css'

// The first ghosts of a lesson are shown before any stroke; a recording only logs ghosts after strokes,
// so the player takes the starting ghosts as a prop.
export default function ReplayPlayer({ recording, initialGhosts = [] }: { recording: TeachRecording; initialGhosts?: Ghost[] }) {
  const length = recordingLength(recording)
  // Before the first Play, the player shows the end of the lesson (what the user drew), not an empty canvas.
  const [elapsed, setElapsed] = useState(length)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    // requestAnimationFrame gives a smooth clock that pauses when the tab is hidden.
    let last = performance.now()
    const tick = (now: number) => {
      const step = (now - last) * REPLAY_SPEED
      last = now
      setElapsed((e) => {
        const next = Math.min(length, e + step)
        if (next >= length) setPlaying(false)
        return next
      })
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [playing, length])

  if (!recording.events.some((e) => e.type === 'stroke')) {
    return <p className="replay-empty">No lesson strokes were recorded, so there is nothing to replay.</p>
  }

  const { strokes, ghosts } = frameAt(recording, elapsed)
  const shownGhosts = recording.events.some((e) => e.type === 'ghosts' && e.t <= elapsed) ? ghosts : initialGhosts
  const finished = elapsed >= length

  function play() {
    if (finished) setElapsed(0)
    setStarted(true)
    setPlaying(true)
  }

  return (
    <figure className="replay-player">
      <div className="canvas-stack">
        <DrawingCanvas strokes={strokes} readOnly label="Replay of your lesson" />
        <GhostLayer ghosts={shownGhosts} />
      </div>
      <figcaption className="replay-controls">
        {playing
          ? <button type="button" className="btn" onClick={() => setPlaying(false)}>Pause</button>
          : <button type="button" className="btn" onClick={play}>{finished && started ? 'Play again' : 'Play'}</button>}
        <button type="button" className="btn btn-quiet" onClick={() => { setElapsed(0); setPlaying(false); setStarted(true) }}>Restart</button>
        <progress max={length} value={elapsed} aria-label="Replay progress" />
        <span className="replay-speed">{REPLAY_SPEED}× speed</span>
      </figcaption>
    </figure>
  )
}
