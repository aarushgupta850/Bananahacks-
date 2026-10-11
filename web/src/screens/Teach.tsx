// Placeholder for the lesson: ghost lines guide the user step by step and adapt after every stroke.
// Jeff's J2c adds the mode selector, accuracy meter, "Show me" and the 2-minute limit.
import { useRef, useState } from 'react'
import DrawingCanvas from '../canvas/DrawingCanvas'
import GhostLayer from '../canvas/GhostLayer'
import { engine } from '../engine'
import type { StrokeResult, UserStroke } from '../engine/types'
import { usePack, useSession, type TeachRecording } from '../session'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

export default function Teach({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()

  // Made once when the screen opens: the lesson (shaped by the weak spots), its teacher, and the recording's clock.
  const [lesson] = useState(() => {
    const steps = engine.buildLesson(pack, session.weaknesses)
    return { steps, teacher: engine.createTeacher(pack, steps, 'auto'), startedAt: performance.now() }
  })
  const [result, setResult] = useState<StrokeResult>(() => lesson.teacher.state())
  const [strokes, setStrokes] = useState<UserStroke[]>([])
  const recording = useRef<TeachRecording>({ events: [] })

  function handleStroke(stroke: UserStroke) {
    // The teacher is called here in the event handler, not inside a state update,
    // because React StrictMode runs state updates twice and the teacher would count the stroke twice.
    const next = lesson.teacher.addStroke(stroke)
    const t = Math.round(performance.now() - lesson.startedAt)
    recording.current.events.push({ t, type: 'stroke', stroke }, { t, type: 'ghosts', ghosts: next.ghosts })
    setStrokes((previous) => [...previous, stroke])
    setResult(next)
  }

  function finish() {
    update({
      steps: lesson.steps,
      modeHistory: lesson.teacher.history(),
      teachRecording: { events: [...recording.current.events] },
    })
    onNext()
  }

  const step = lesson.steps.find((s) => s.id === result.currentStepId)

  return (
    <PlaceholderScreen
      title="Teach"
      lead="Ghost lines guide you step by step, and fade as you get it right."
      onBack={onBack}
      onNext={finish}
      nextLabel="Go to retest"
    >
      <div className="teach-step" aria-live="polite">
        {step ? (
          <>
            <h2>{step.label}</h2>
            <p>{step.tip}</p>
          </>
        ) : (
          <h2>Lesson complete</h2>
        )}
        {result.warning && <p className="teach-warning">{result.warning}</p>}
      </div>
      <div className="canvas-stack">
        <DrawingCanvas strokes={strokes} onStroke={handleStroke} />
        <GhostLayer ghosts={result.ghosts} />
      </div>
    </PlaceholderScreen>
  )
}
