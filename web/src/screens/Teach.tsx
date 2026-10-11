// Screen 5: the lesson. Ghost lines guide the user step by step, and the engine's teacher checks every stroke
// and adapts: in Auto it fades from full guides (Guided) to dots to connect (Hints) to nothing (Check-in) as
// accuracy rises, and steps back when it drops. The UI only shows what the teacher returns.
// Everything that happens is recorded so the report can replay it at 4x.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CanvasToolbar from '../canvas/CanvasToolbar'
import { strokesToPngBase64 } from '../canvas/canvasPng'
import DrawingCanvas from '../canvas/DrawingCanvas'
import GhostLayer from '../canvas/GhostLayer'
import { strokeToPath, PEN_SIZES, TARGET_SIZE, toSvgPoints, type PenSize } from '../canvas/geometry'
import { engine } from '../engine'
import type { Ghost, HelpLevel, ModeChange, Mode, Pack, StrokeResult, UserStroke } from '../engine/types'
import { checkLive, regenerate } from '../lib/live'
import { usePack, useSession, type TeachRecording } from '../session'
import CountdownRing from './CountdownRing'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'
import { skipStep } from './skipStep'
import { guideMovement, IDENTITY, lineLength, revealFor, traceReveal, type Similarity } from './trace'
import { useCountdown } from './useCountdown'

const LESSON_SECONDS = 120
const SHOW_ME_MS = 3000
const TOAST_MS = 4000
const CHEER_MS = 1600
// After this many strokes on one step without finishing it, the full guide line shows (even in Hints or
// Check-in) with a nudge toward "Skip step". The engine itself moves on after a few more.
const STUCK_AFTER = 3
// How faint the trace of the real drawing is at each help level: it fades with the help, and Check-in has none.
const TRACE_OPACITY: Record<HelpLevel, number> = { guided: 0.35, hints: 0.22, checkin: 0 }

// "Happy accidents" (only with ?happy=1 in the URL, and only when the live server is online): a stroke that
// scores below 0.35 is sent to image AI, which redraws the target around the user's lines. The lesson then
// carries on with the new guides, so the mistake becomes part of the drawing.
const HAPPY = new URLSearchParams(window.location.search).get('happy') === '1'
const HAPPY_BELOW = 0.35
const HAPPY_COOLDOWN_MS = 45_000 // at most one redraw every 45 s...
const HAPPY_MAX = 2              // ...and two per lesson: each redraw restarts the steps, so more would never let a lesson end
const SWAP_FADE_MS = 400
const HAPPY_TOAST = 'Nice, we\u2019ve worked that into your drawing.'

// The words that describe the subject, for the redraw: the live prompt if there was one, else "a fox".
const subjectWords = (pack: Pack) => (pack.source.kind === 'prompt' && pack.source.prompt ? pack.source.prompt : `a ${pack.subject}`)
// The meter eases toward each new accuracy instead of jumping, so one bad stroke doesn't look like a crash.
// 0.4 = each stroke moves the meter 40% of the way to its accuracy.
const METER_EASING = 0.4

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Help fades as you improve' },
  { id: 'guided', label: 'Guided', hint: 'Full ghost lines' },
  { id: 'hints', label: 'Hints', hint: 'Key points only' },
  { id: 'checkin', label: 'Check-in', hint: 'No guides unless you ask' },
]

// The total length of the drawing's real lines, which the trace reveals bit by bit.
const drawingLength = (pack: Pack) => pack.strokes.filter((s) => s.tier !== 'construction').reduce((sum, s) => sum + lineLength(s.points), 0)

// Milliseconds since the lesson started, for the recording.
const sinceStart = (start: number) => Math.round(performance.now() - start)

const HELP_NAMES: Record<HelpLevel, string> = { guided: 'Guided', hints: 'Hints', checkin: 'Check-in' }

export default function Teach({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()

  // Made when the screen opens: the lesson (shaped by the weak spots) and its teacher. A happy accident
  // replaces both with the redrawn pack's.
  const [lesson, setLesson] = useState(() => {
    const steps = engine.buildLesson(pack, session.weaknesses)
    return { pack, steps, teacher: engine.createTeacher(pack, steps, 'auto') }
  })
  const [result, setResult] = useState<StrokeResult>(() => lesson.teacher.state())
  const [mode, setModeState] = useState<Mode>('auto')
  const [strokes, setStrokes] = useState<UserStroke[]>([])
  const [penSize, setPenSize] = useState<PenSize>('medium')
  const [meter, setMeter] = useState<number | null>(null) // eased accuracy, 0-1; null before the first match
  const [showMe, setShowMe] = useState<Ghost[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [cheer, setCheer] = useState<{ id: number; text: string } | null>(null) // "Step done" / "Drawn for you"
  const [assisted, setAssisted] = useState<UserStroke[]>([]) // lines drawn for the user by "Skip step"
  const [stuck, setStuck] = useState(false) // several strokes on this step without finishing it
  const triesHere = useRef(0)
  const skipNoise = useRef(new Set<number>()) // help-level changes (indices in teacher.history()) made by skips
  const happyCount = useRef(0)
  // How much of the real drawing's trace is revealed (pixels of line). Every stroke adds to it; undo and
  // clear never take it back.
  const [revealed, setRevealed] = useState(0)
  const [toastKind, setToastKind] = useState<'warning' | 'happy'>('warning')
  // Happy accidents: is the live server up, is a redraw on its way, and the old guides fading out after a swap.
  const [liveOnline, setLiveOnline] = useState(false)
  const [redrawing, setRedrawing] = useState(false)
  const [fadingGhosts, setFadingGhosts] = useState<Ghost[] | null>(null)
  const [swaps, setSwaps] = useState(0) // remounts the new guides so they fade in
  const lastRedrawAt = useRef(-Infinity)
  const earlierHistory = useRef<ModeChange[]>([]) // help-level changes from teachers replaced by a redraw

  // The recording starts with the ghosts shown before the first stroke, so the replay opens the same way.
  const recording = useRef<TeachRecording>({ events: [{ t: 0, type: 'ghosts', ghosts: result.ghosts }] })
  const startedAt = useRef(0)
  const timers = useRef<number[]>([])
  const cheers = useRef(0) // how many "Step done" flashes so far (each one's id)
  const closed = useRef(false) // a redraw that answers after the screen closed is ignored
  useEffect(() => {
    startedAt.current = performance.now()
    closed.current = false
    const pending = timers.current
    if (HAPPY) checkLive().then((ok) => { if (!closed.current) setLiveOnline(ok) })
    return () => {
      closed.current = true
      pending.forEach(clearTimeout)
    }
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
    reveal([stroke])
    // A quick "Step done" when this stroke finished a step (not on the last one: the panel above says so).
    if (!next.done && next.completedStepIds.length > result.completedStepIds.length) flash('Step done')
    setResult(next)
    // Stuck on a step: show its whole guide line until the step is done, and point at "Skip step".
    triesHere.current = next.currentStepId === result.currentStepId && !next.done ? triesHere.current + 1 : 0
    const isStuck = triesHere.current >= STUCK_AFTER
    setStuck(isStuck)
    setShowMe(isStuck && next.helpLevel !== 'guided' ? lesson.teacher.showMe() : null)
    const accuracy = next.accuracy
    if (accuracy !== null) setMeter((m) => (m === null ? accuracy : m + (accuracy - m) * METER_EASING))
    if (next.warning) showToast(next.warning, 'warning')
    if (HAPPY && liveOnline && !redrawing && accuracy !== null && accuracy < HAPPY_BELOW && !next.done) {
      happyAccident([...assisted, ...strokes, stroke])
    }
  }

  // Each stroke reveals more of the trace: as much line as it drew, at least 1/12 of the drawing.
  function reveal(drawn: UserStroke[]) {
    const total = drawingLength(lesson.pack)
    const more = drawn.reduce((sum, st) => sum + revealFor(lineLength(st.points.map(([x, y]): [number, number] => [x, y])), total), 0)
    setRevealed((r) => r + more)
  }

  function flash(text: string) {
    const id = ++cheers.current
    setCheer({ id, text })
    later(CHEER_MS, () => setCheer((current) => (current?.id === id ? null : current)))
  }

  // "Skip step": the app draws this step's lines (in soft gray, so it's clear the user didn't draw them) and the
  // lesson moves on; the user can draw the next step or skip again.
  function skip() {
    const { result: next, drawn, ignoreHistory: [from, to] } = skipStep(lesson.teacher, lesson.steps, mode)
    for (let i = from; i < to; i++) skipNoise.current.add(i)
    const t = sinceStart(startedAt.current)
    drawn.forEach((stroke) => recording.current.events.push({ t, type: 'stroke', stroke }))
    recording.current.events.push({ t, type: 'ghosts', ghosts: next.ghosts })
    setAssisted((previous) => [...previous, ...drawn])
    reveal(drawn)
    setResult(next)
    setShowMe(null)
    setStuck(false)
    triesHere.current = 0
    lastRedrawAt.current = t // no AI redraw right after a skip: the user just asked for the plan's own lines
    if (!next.done) flash('Drawn for you. Your turn!')
  }

  // A teacher's help-level changes, without the ones "Skip step" caused (those weren't the user's doing).
  const realHistory = (teacher: typeof lesson.teacher) => teacher.history().filter((_, i) => !skipNoise.current.has(i))

  function showToast(text: string, kind: 'warning' | 'happy') {
    setToast(text)
    setToastKind(kind)
    later(TOAST_MS, () => setToast((current) => (current === text ? null : current)))
  }

  // The lesson right now, for a redraw that answers later.
  const latest = useRef({ teacher: lesson.teacher, mode, ghosts: result.ghosts, done: result.done })
  useEffect(() => {
    latest.current = { teacher: lesson.teacher, mode, ghosts: showMe ?? result.ghosts, done: result.done }
  }, [lesson, mode, result, showMe])

  // Sends the drawing to image AI in the background (drawing carries on), then swaps in the redrawn lesson.
  // Any failure (offline, busy, too slow) is silent: the current lesson simply continues.
  function happyAccident(drawing: UserStroke[]) {
    const now = sinceStart(startedAt.current)
    if (happyCount.current >= HAPPY_MAX || now - lastRedrawAt.current < HAPPY_COOLDOWN_MS) return
    lastRedrawAt.current = now
    happyCount.current++
    setRedrawing(true)
    regenerate({ prompt: subjectWords(pack), canvasBase64: strokesToPngBase64(drawing), difficulty: pack.difficulty })
      .then((newPack) => {
        if (closed.current || newPack.steps.length === 0) return
        // The answer comes seconds later, so use the lesson as it is now, not as it was when the stroke was drawn.
        const now = latest.current
        if (now.done) return
        const teacher = engine.createTeacher(newPack, newPack.steps, now.mode)
        const fresh = teacher.state()
        if (fresh.done) return // the AI kept nothing new to draw: stay on the current lesson
        earlierHistory.current.push(...realHistory(now.teacher))
        skipNoise.current = new Set()
        triesHere.current = 0
        setStuck(false)
        // Crossfade: the old guides fade out while the new ones fade in.
        setFadingGhosts(now.ghosts)
        later(SWAP_FADE_MS, () => setFadingGhosts(null))
        setSwaps((n) => n + 1)
        setLesson({ pack: newPack, steps: newPack.steps, teacher })
        setResult(fresh)
        setShowMe(null)
        recording.current.events.push({ t: sinceStart(startedAt.current), type: 'ghosts', ghosts: fresh.ghosts })
        showToast(HAPPY_TOAST, 'happy')
      })
      .catch((error: unknown) => console.info('Happy accident skipped:', error))
      .finally(() => { if (!closed.current) setRedrawing(false) })
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
      modeHistory: [...earlierHistory.current, ...realHistory(lesson.teacher)],
      teachRecording: { events: [...recording.current.events] },
    })
    onNext()
  }, [lesson, update, onNext])

  // The lesson ends when the teacher says done (the clock stops) or after 2 minutes.
  const remaining = useCountdown(LESSON_SECONDS, finish, !result.done)

  const stepIndex = lesson.steps.findIndex((s) => s.id === result.currentStepId)
  const step = stepIndex >= 0 ? lesson.steps[stepIndex] : undefined
  const ghosts = showMe ?? result.ghosts

  // The trace of the real drawing, moved the same way the guides have moved to follow the user.
  const plan = useMemo(() => new Map(lesson.pack.strokes.map((s) => [s.id, s.points])), [lesson.pack])
  // showMe() only reads the teacher (full guides, wherever they are now); it changes nothing.
  const movement: Similarity = useMemo(
    () => (result.done ? null : guideMovement(lesson.teacher.showMe(), plan)) ?? IDENTITY,
    [lesson, result, plan],
  )
  // Once the lesson is done the whole drawing shows, faint, as the finished picture.
  const traced = traceReveal(lesson.pack.strokes, lesson.steps, result.done ? lesson.steps.length : stepIndex, result.done ? Infinity : revealed)
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
                <p>{stuck ? 'Stuck? Trace the blue line, or press Skip step and we\u2019ll draw this part for you.' : step.tip}</p>
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
            {/* Under everything: a faint trace of the real drawing, revealed part by part as the lesson goes on. */}
            <svg className="trace-layer" viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`} aria-hidden="true"
              style={{ opacity: TRACE_OPACITY[result.done ? 'guided' : result.helpLevel] }}>
              <g transform={`matrix(${movement.a} ${movement.b} ${-movement.b} ${movement.a} ${movement.tx} ${movement.ty})`}>
                {traced.map((t) => <polyline key={t.id} points={toSvgPoints(t.points)} vectorEffect="non-scaling-stroke" />)}
              </g>
            </svg>
            {/* Lines "Skip step" drew for the user, in soft gray so they're never mistaken for the user's own ink. */}
            <svg className="assist-layer" viewBox={`0 0 ${TARGET_SIZE} ${TARGET_SIZE}`} aria-hidden="true">
              {assisted.map((stroke, i) => <path key={i} d={strokeToPath(stroke.points, true, PEN_SIZES.medium)} />)}
            </svg>
            <DrawingCanvas strokes={strokes} onStroke={handleStroke} penSize={penSize} label="Lesson canvas. Draw over the ghost lines." />
            {fadingGhosts && <div className="ghost-swap is-out"><GhostLayer ghosts={fadingGhosts} /></div>}
            <div key={swaps} className={swaps > 0 ? 'ghost-swap is-in' : 'ghost-swap'}><GhostLayer ghosts={ghosts} /></div>
            {redrawing && <p className="teach-redrawing" role="status">Working your line into the drawing…</p>}
            {cheer && !result.done && <p key={cheer.id} className="teach-cheer" role="status"><span aria-hidden="true">✓ </span>{cheer.text}</p>}
            {toast && !result.done && (
              <p className={toastKind === 'happy' ? 'teach-toast is-happy' : 'teach-toast'} role="status">
                <span aria-hidden="true">{toastKind === 'happy' ? '✨ ' : '⚠ '}</span>{toast}
              </p>
            )}
          </div>
          {/* Undo and clear only tidy the ink here: the teacher has already checked those strokes. */}
          <CanvasToolbar
            penSize={penSize}
            onPenSize={setPenSize}
            onUndo={() => setStrokes((s) => s.slice(0, -1))}
            onClear={() => { setStrokes([]); setAssisted([]) }}
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

          <div className="teach-actions">
            <button type="button" className="btn" onClick={revealStep} disabled={result.done}>
              Show me
            </button>
            {/* Always a way forward: the app draws this step and the next one appears. */}
            <button type="button" className={stuck ? 'btn btn-primary' : 'btn'} onClick={skip} disabled={result.done}
              title="Draw this step for me and go to the next one">
              Skip step
            </button>
          </div>
        </aside>
      </div>
    </PlaceholderScreen>
  )
}
