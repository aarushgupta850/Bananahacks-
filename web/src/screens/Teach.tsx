// Screen 5: the lesson. Ghost lines guide the user step by step, and the engine's teacher checks every stroke
// and adapts: in Auto it fades from full guides (Guided) to dots to connect (Hints) to nothing (Check-in) as
// accuracy rises, and steps back when it drops. The UI only shows what the teacher returns.
// Everything that happens is recorded so the report can replay it at 4x.
import { useCallback, useEffect, useRef, useState } from 'react'
import CanvasToolbar from '../canvas/CanvasToolbar'
import DrawingCanvas from '../canvas/DrawingCanvas'
import GhostLayer from '../canvas/GhostLayer'
import type { PenSize } from '../canvas/geometry'
import { engine } from '../engine'
import type { Ghost, HelpLevel, Mode, StrokeResult, UserStroke } from '../engine/types'
import { usePack, useSession, type TeachRecording } from '../session'
import CountdownRing from './CountdownRing'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'
import { useCountdown } from './useCountdown'

const LESSON_SECONDS = 120
const SHOW_ME_MS = 3000
const TOAST_MS = 4000
const CHEER_MS = 1600
// The meter eases toward each new accuracy instead of jumping, so one bad stroke doesn't look like a crash.
// 0.4 = each stroke moves the meter 40% of the way to its accuracy.
const METER_EASING = 0.4

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Help fades as you improve' },
  { id: 'guided', label: 'Guided', hint: 'Full ghost lines' },
  { id: 'hints', label: 'Hints', hint: 'Key points only' },
  { id: 'checkin', label: 'Check-in', hint: 'No guides unless you ask' },
]

// Milliseconds since the lesson started, for the recording.
const sinceStart = (start: number) => Math.round(performance.now() - start)

const HELP_NAMES: Record<HelpLevel, string> = { guided: 'Guided', hints: 'Hints', checkin: 'Check-in' }

export default function Teach({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()

  // Made once when the screen opens: the lesson (shaped by the weak spots) and its teacher.
  const [lesson] = useState(() => {
    const steps = engine.buildLesson(pack, session.weaknesses)
    return { steps, teacher: engine.createTeacher(pack, steps, 'auto') }
  })
  const [result, setResult] = useState<StrokeResult>(() => lesson.teacher.state())
  const [mode, setModeState] = useState<Mode>('auto')
  const [strokes, setStrokes] = useState<UserStroke[]>([])
  const [penSize, setPenSize] = useState<PenSize>('medium')
  const [meter, setMeter] = useState<number | null>(null) // eased accuracy, 0-1; null before the first match
  const [showMe, setShowMe] = useState<Ghost[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [cheer, setCheer] = useState(0) // bumped when a step is finished, to flash "Step done"

  // The recording starts with the ghosts shown before the first stroke, so the replay opens the same way.
  const recording = useRef<TeachRecording>({ events: [{ t: 0, type: 'ghosts', ghosts: result.ghosts }] })
  const startedAt = useRef(0)
  const timers = useRef<number[]>([])
  const cheers = useRef(0) // how many "Step done" flashes so far (each one's id)
  useEffect(() => {
    startedAt.current = performance.now()
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  function later(ms: number, run: () => void) {
    timers.current.push(window.setTimeout(run, ms))
  }

  function handleStroke(stroke: UserStroke) {
    // The teacher is called here in the event handler, not inside a state update,
    // because React StrictMode runs state updates twice and the teacher would count the stroke twice.
    const next = lesson.teacher.addStroke(stroke)
    const t = sinceStart(startedAt.current)
    recording.current.events.push({ t, type: 'stroke', stroke }, { t, type: 'ghosts', ghosts: next.ghosts })
    setStrokes((previous) => [...previous, stroke])
    // A quick "Step done" when this stroke finished a step (not on the last one: the panel above says so).
    if (!next.done && next.completedStepIds.length > result.completedStepIds.length) {
      const id = ++cheers.current
      setCheer(id)
      later(CHEER_MS, () => setCheer((current) => (current === id ? 0 : current)))
    }
    setResult(next)
    setShowMe(null)
    const accuracy = next.accuracy
    if (accuracy !== null) setMeter((m) => (m === null ? accuracy : m + (accuracy - m) * METER_EASING))
    if (next.warning) {
      const warning = next.warning
      setToast(warning)
      later(TOAST_MS, () => setToast((current) => (current === warning ? null : current)))
    }
  }

  function changeMode(next: Mode) {
    setModeState(next)
    const updated = lesson.teacher.setMode(next)
    setResult(updated)
    recording.current.events.push({ t: sinceStart(startedAt.current), type: 'ghosts', ghosts: updated.ghosts })
  }

  function revealStep() {
    const ghosts = lesson.teacher.showMe()
    setShowMe(ghosts)
    later(SHOW_ME_MS, () => setShowMe((current) => (current === ghosts ? null : current)))
  }

  const finish = useCallback(() => {
    update({
      steps: lesson.steps,
      modeHistory: lesson.teacher.history(),
      teachRecording: { events: [...recording.current.events] },
    })
    onNext()
  }, [lesson, update, onNext])

  // The lesson ends when the teacher says done (the clock stops) or after 2 minutes.
  const remaining = useCountdown(LESSON_SECONDS, finish, !result.done)

  const stepIndex = lesson.steps.findIndex((s) => s.id === result.currentStepId)
  const step = stepIndex >= 0 ? lesson.steps[stepIndex] : undefined
  const ghosts = showMe ?? result.ghosts
  // Steps the teacher had to drop (nothing to draw) never show up as completed, so a finished lesson is shown full.
  const stepsDone = result.done ? lesson.steps.length : result.completedStepIds.length

  return (
    <PlaceholderScreen
      compact
      title="Lesson"
      lead="Follow the ghost lines. They adapt to every stroke and fade as you get it right."
      onBack={onBack}
      onNext={finish}
      nextLabel={result.done ? 'Go to retest' : 'Skip to retest'}
    >
      <div className="teach-layout">
        <div className="canvas-column">
          <div className={result.done ? 'teach-step is-done' : 'teach-step'} aria-live="polite">
            {step ? (
              <>
                <span className="step-count">Step {stepIndex + 1} of {lesson.steps.length}</span>
                <h2>{step.label}</h2>
                <p>{step.tip}</p>
              </>
            ) : (
              <>
                <span className="step-count"><span aria-hidden="true">✓ </span>All {lesson.steps.length} steps done</span>
                <h2>Lesson complete</h2>
                <p>Nice work. Press <strong>Go to retest</strong> to try it on your own.</p>
              </>
            )}
          </div>
          {/* How far through the lesson the user is, so a long lesson never feels endless. */}
          <div className="step-progress" role="progressbar" aria-label="Lesson progress"
            aria-valuemin={0} aria-valuemax={lesson.steps.length} aria-valuenow={stepsDone}>
            <div className="step-progress-fill" style={{ width: `${(stepsDone / Math.max(1, lesson.steps.length)) * 100}%` }} />
          </div>
          <div className="canvas-stack">
            <DrawingCanvas strokes={strokes} onStroke={handleStroke} penSize={penSize} label="Lesson canvas. Draw over the ghost lines." />
            <GhostLayer ghosts={ghosts} />
            {cheer !== 0 && !result.done && <p key={cheer} className="teach-cheer" role="status"><span aria-hidden="true">✓ </span>Step done</p>}
            {toast && !result.done && <p className="teach-toast" role="status"><span aria-hidden="true">⚠ </span>{toast}</p>}
          </div>
          {/* Undo and clear only tidy the ink here: the teacher has already checked those strokes. */}
          <CanvasToolbar
            penSize={penSize}
            onPenSize={setPenSize}
            onUndo={() => setStrokes((s) => s.slice(0, -1))}
            onClear={() => setStrokes([])}
            canUndo={strokes.length > 0}
          />
        </div>

        <aside className="teach-panel" aria-label="Lesson controls">
          <div className="panel-timer">
            <CountdownRing remaining={remaining} total={LESSON_SECONDS} />
            <span className="panel-label">{result.done ? 'Lesson finished' : 'Lesson time left'}</span>
          </div>

          <div className="panel-block">
            <span className="panel-label">Help level now</span>
            <span className={`help-pill help-${result.helpLevel}`}>{HELP_NAMES[result.helpLevel]}</span>
          </div>

          <div className="panel-block">
            <span className="panel-label" id="accuracy-label">Accuracy</span>
            <div className="meter" role="meter" aria-labelledby="accuracy-label" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={meter === null ? undefined : Math.round(meter * 100)}>
              <div className="meter-fill" style={{ width: `${(meter ?? 0) * 100}%` }} />
            </div>
            <span className="meter-text">
              {result.accuracy !== null
                ? `Last stroke: ${Math.round(result.accuracy * 100)}% match`
                : meter === null ? 'Draw a stroke to see how close it is' : 'That stroke was far from the guide. Try tracing the blue line, or press Show me.'}
            </span>
          </div>

          <div className="panel-block">
            <span className="panel-label" id="mode-label">Mode</span>
            <div className="segmented mode-switch" role="radiogroup" aria-labelledby="mode-label">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} title={m.hint}
                  className={mode === m.id ? 'is-active' : ''} onClick={() => changeMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="mode-hint">{MODES.find((m) => m.id === mode)?.hint}</span>
          </div>

          <button type="button" className="btn" onClick={revealStep} disabled={result.done}>
            Show me
          </button>
        </aside>
      </div>
    </PlaceholderScreen>
  )
}
