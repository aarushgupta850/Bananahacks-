// Screen 7: the report card. It proves the user improved with real numbers: every score, percentage and
// coaching line comes from the engine (score, coach and the two analyses). The UI only lays them out.
import { toPng } from 'html-to-image'
import { useEffect, useRef, useState } from 'react'
import DrawingCanvas from '../canvas/DrawingCanvas'
import ReplayPlayer from '../canvas/ReplayPlayer'
import { engine } from '../engine'
import type { Analysis, Box, Pack, Score, UserStroke } from '../engine/types'
import { loadIndex, loadPack, resolveAsset } from '../lib/packs'
import { loadHistory, makeRecord, reportHighlights, saveSession, sessionIdFor } from '../lib/progress'
import { usePack, useSession } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen from './PlaceholderScreen'
import { changeWords, describeModeHistory, describeScale, emptyRoundNote, formatChange, harderDifficulty } from './reportText'
import { timingLabel } from './timeLimit'
import '../styles/progress.css'

const LEVEL_UP_SCORE = 75 // "Level up" shows when the retest total is at least this
const COUNT_UP_MS = 900

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// Counts from 0 up to `target` once, easing out. Under reduced motion it shows the number straight away.
function useCountUp(target: number): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  useEffect(() => {
    if (prefersReducedMotion()) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      setValue(Math.round(target * (1 - (1 - t) ** 3))) // ease-out cubic
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return value
}

interface ReportProps {
  onBack: () => void
  onStartPack: (pack: Pack) => void // starts a new run on another pack (Level up)
}

export default function Report({ onBack, onStartPack }: ReportProps) {
  const pack = usePack()
  const { session, restart } = useSession()
  const [showPipeline, setShowPipeline] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const test = session.testAnalysis
  const retest = session.retestAnalysis

  // Both rounds always store an analysis before the report opens; this is a friendly guard, not an error.
  if (!test || !retest) {
    return (
      <PlaceholderScreen title="Report" lead="We need both drawings to make your report." onBack={onBack}
        extraActions={<button type="button" className="btn btn-primary" onClick={restart}>Start over</button>} />
    )
  }

  return (
    <PlaceholderScreen
      title="Your report card"
      lead={`${pack.title}: your test and retest, measured.`}
      onBack={onBack}
      extraActions={
        <>
          <button type="button" className="btn" onClick={() => setShowPipeline(true)}>How this lesson was made</button>
          <button type="button" className="btn btn-primary" onClick={restart}>Try another subject</button>
        </>
      }
    >
      <ReportBody pack={pack} test={test} retest={retest} overlay={overlay} setOverlay={setOverlay} onStartPack={onStartPack} />
      <PipelinePanel pack={pack} open={showPipeline} onClose={() => setShowPipeline(false)} />
    </PlaceholderScreen>
  )
}

interface BodyProps {
  pack: Pack
  test: Analysis
  retest: Analysis
  overlay: boolean
  setOverlay: (on: boolean) => void
  onStartPack: (pack: Pack) => void
}

function ReportBody({ pack, test, retest, overlay, setOverlay, onStartPack }: BodyProps) {
  const { session } = useSession()
  // Scores and coaching are worked out once (the engine is deterministic, so this only saves time).
  const [results] = useState(() => ({
    testScore: engine.score(test),
    retestScore: engine.score(retest),
    coaching: engine.coach(pack, test, retest),
  }))
  const { testScore, retestScore, coaching } = results
  // This session for "Your progress": the engine's two totals, saved once. The id is tied to the retest
  // analysis, so re-rendering or remounting the report (or StrictMode's double effects) never saves it twice.
  // The highlight lines are worked out from the history saved before this session.
  const [progress] = useState(() => {
    const now = Date.now()
    const record = makeRecord(pack, testScore.total, retestScore.total, sessionIdFor(retest, now), now)
    return { record, highlights: reportHighlights(loadHistory(), record, now) }
  })
  useEffect(() => {
    saveSession(progress.record)
  }, [progress])
  const card = useRef<HTMLDivElement>(null)
  const [downloadProblem, setDownloadProblem] = useState(false)

  async function download() {
    if (!card.current) return
    setDownloadProblem(false)
    try {
      // pixelRatio 2 keeps the image sharp when shared; the paper color fills the background.
      const url = await toPng(card.current, { pixelRatio: 2, backgroundColor: '#faf7f2' })
      const link = document.createElement('a')
      link.href = url
      link.download = `ghost-lines-${pack.id}-report.png`
      link.click()
    } catch (error) {
      console.error(error)
      setDownloadProblem(true)
    }
  }

  const scaleNotes = [describeScale(test.overallScale), describeScale(retest.overallScale)]

  return (
    <div className="report">
      {/* The compact card that "Download report card" saves as a PNG: title, drawings and scores. */}
      <div className="report-card" ref={card}>
        <div className="report-card-head">
          <span className="report-brand">Ghost Lines</span>
          <h2>{pack.title}</h2>
          {/* Both rounds used this limit, so the comparison is like for like. */}
          <span className="chip report-timing">{timingLabel(session.soloSeconds)}</span>
        </div>

        <div className="report-drawings">
          <DrawingPanel title="Test" strokes={overlay ? test.alignedStrokes : session.testStrokes}
            analysis={test} pack={pack} overlay={overlay} note={scaleNotes[0]} />
          <DrawingPanel title="Retest" strokes={overlay ? retest.alignedStrokes : session.retestStrokes}
            analysis={retest} pack={pack} overlay={overlay} note={scaleNotes[1]} />
          <figure className="report-drawing">
            <figcaption>Target</figcaption>
            <div className="report-frame">
              <img src={resolveAsset(pack, pack.target)} alt={`${pack.title}: the target drawing`} width={768} height={768} />
              {overlay && <BoxOverlay boxes={pack.parts.map((p) => ({ box: p.box, label: `target ${p.label.toLowerCase()}`, kind: 'target' }))} />}
            </div>
          </figure>
        </div>

        <Scores before={testScore} after={retestScore} />
        {progress.highlights.length > 0 && (
          <ul className="report-highlights" aria-label="Your progress">
            {progress.highlights.map((h) => <li key={h.kind} className={`is-${h.kind}`}>{h.text}</li>)}
          </ul>
        )}
      </div>

      {/* A round with nothing drawn (Skip, or the timer ran out) scores 0: say why, so a 0 never looks like a bug. */}
      {emptyRoundNote(test.alignedStrokes.length === 0, retest.alignedStrokes.length === 0) && (
        <p className="notice" role="status">{emptyRoundNote(test.alignedStrokes.length === 0, retest.alignedStrokes.length === 0)}</p>
      )}

      <label className="overlay-toggle">
        <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
        Show part boxes (yours solid, the target's dashed)
      </label>
      {overlay && <p className="muted small">With boxes on, your drawings are shown aligned to the target's size and position, the way the engine measured them.</p>}

      <div className="report-columns">
        <section className="report-section" aria-labelledby="fix-title">
          <h2 id="fix-title">What to fix</h2>
          <ul className="coach-list">
            {coaching.fix.map((item, i) => (
              <li key={i} className={`coach-item is-${item.status}`}>
                <span className="coach-status">{coachLabel(item.status, item.text)}</span>
                {item.text}
              </li>
            ))}
            {coaching.fix.length === 0 && <li className="coach-item is-good">Nothing big to fix. Great drawing!</li>}
          </ul>
        </section>
        <section className="report-section" aria-labelledby="good-title">
          <h2 id="good-title">Already good</h2>
          <ul className="coach-list">
            {coaching.good.map((item, i) => (
              <li key={i} className="coach-item is-good">
                <span className="coach-status">★ Good</span>
                {item.text}
              </li>
            ))}
            {coaching.good.length === 0 && <li className="coach-item">Keep practicing: strengths show up here.</li>}
          </ul>
        </section>
      </div>

      <section className="report-section" aria-labelledby="replay-title">
        <h2 id="replay-title">Your lesson, replayed</h2>
        <p className="muted">How the help changed: {describeModeHistory(session.modeHistory)}</p>
        <div className="report-replay">
          <ReplayPlayer recording={session.teachRecording} />
        </div>
      </section>

      <div className="report-actions">
        <button type="button" className="btn" onClick={download}>Download report card</button>
        {retestScore.total >= LEVEL_UP_SCORE && <LevelUp pack={pack} onStartPack={onStartPack} />}
      </div>
      {downloadProblem && <p className="notice" role="status">The image didn't save. Try again, or take a screenshot instead.</p>}
    </div>
  )
}

// The status words above each "What to fix" line. Text, not only color, carries the meaning.
// The engine starts a problem the test didn't have with "New this time:", which gets its own label.
function coachLabel(status: 'improved' | 'not-yet' | 'good', text: string): string {
  if (status === 'improved') return '✓ Improved'
  if (text.startsWith('New this time')) return '! New'
  return '… Not yet'
}

// ---------- drawings with optional part boxes ----------

interface OverlayBox { box: Box; label: string; kind: 'user' | 'target' }

// Colors are SVG attributes, not CSS classes, so "Download report card" (html-to-image) draws them too:
// it copies inline attributes but not stylesheet rules onto SVG shapes. Yours: solid accent; target: dashed ink.
const BOX_STYLE = {
  user: { fill: 'rgba(59, 108, 255, 0.08)', stroke: '#3b6cff', strokeWidth: 4, dash: undefined },
  target: { fill: 'none', stroke: '#1c1b19', strokeWidth: 3, dash: '10 8' },
} as const

// Your label sits at the top of your box and the target's at the bottom of its box, so when the two boxes
// nearly match (a good drawing) the labels never print on top of each other.
const labelY = (b: OverlayBox) => (b.kind === 'user' ? b.box[1] + 22 : b.box[1] + b.box[3] - 8)

function BoxOverlay({ boxes }: { boxes: OverlayBox[] }) {
  return (
    <svg className="box-overlay" viewBox="0 0 768 768" aria-hidden="true">
      {boxes.map((b, i) => {
        const style = BOX_STYLE[b.kind]
        return (
          <g key={i}>
            <rect x={b.box[0]} y={b.box[1]} width={b.box[2]} height={b.box[3]}
              fill={style.fill} stroke={style.stroke} strokeWidth={style.strokeWidth} strokeDasharray={style.dash} />
            <text x={b.box[0] + 6} y={labelY(b)} fill={style.stroke} stroke="#ffffff" strokeWidth={5}
              paintOrder="stroke" fontSize={22} fontWeight={700} fontFamily="Inter, system-ui, sans-serif">{b.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

interface DrawingPanelProps {
  title: string
  strokes: UserStroke[]
  analysis: Analysis
  pack: Pack
  overlay: boolean
  note: string | null
}

function DrawingPanel({ title, strokes, analysis, pack, overlay, note }: DrawingPanelProps) {
  // Your boxes AND the target's, so the two can be compared inside one picture.
  const boxes: OverlayBox[] = overlay ? [
    ...pack.parts.map((p): OverlayBox => ({ box: p.box, label: `target ${p.label.toLowerCase()}`, kind: 'target' })),
    ...analysis.parts.flatMap((m): OverlayBox[] => (m.userBox ? [{ box: m.userBox, label: `your ${m.label.toLowerCase()}`, kind: 'user' }] : [])),
  ] : []
  return (
    <figure className="report-drawing">
      <figcaption>{title}</figcaption>
      <div className="report-frame">
        <DrawingCanvas strokes={strokes} readOnly label={`Your ${title.toLowerCase()} drawing`} />
        {overlay && <BoxOverlay boxes={boxes} />}
      </div>
      {note && <p className="scale-note">{note}</p>}
    </figure>
  )
}

// ---------- scores ----------

function Scores({ before, after }: { before: Score; after: Score }) {
  const shown = useCountUp(after.total)
  const shownBefore = useCountUp(before.total)
  const change = formatChange(before.total, after.total)
  const improved = after.total > before.total
  return (
    <div className="scores">
      <div className="score-totals">
        {/* The numbers count up; the labels give screen readers the final value straight away. */}
        <div className="score-box" role="img" aria-label={`Test score: ${before.total} out of 100`}>
          <span className="score-label" aria-hidden="true">Test</span>
          <span className="score-number" aria-hidden="true">{shownBefore}</span>
        </div>
        <span className="score-arrow" aria-hidden="true">→</span>
        <div className="score-box" role="img" aria-label={`Retest score: ${after.total} out of 100`}>
          <span className="score-label" aria-hidden="true">Retest</span>
          <span className="score-number is-retest" aria-hidden="true">{shown}</span>
        </div>
        <div className={improved ? 'change-badge is-up' : 'change-badge'} role="img"
          aria-label={`Change: ${change} ${changeWords(before.total, after.total)}`}>
          <span aria-hidden="true">{change}</span>
          <span className="change-word" aria-hidden="true">{changeWords(before.total, after.total)}</span>
        </div>
      </div>
      <div className="score-breakdown">
        <dl className="score-bars">
          <ScoreBar name="Proportion" hint="part sizes and places" before={before.proportion} after={after.proportion} />
          <ScoreBar name="Shape" hint="lines on the target's lines" before={before.shape} after={after.shape} />
          <ScoreBar name="Line" hint="smooth, single strokes" before={before.line} after={after.line} />
        </dl>
        <p className="score-note">
          Scores are out of 100. Proportion counts most, then shape, then line. Proportion and line only count in
          full once your drawing matches the target's shape. Where you draw on the canvas never costs points, but size
          does: a drawing more than 15% bigger or smaller than the reference loses proportion points.
        </p>
      </div>
    </div>
  )
}

// Two thin bars per measure, test above retest, each labeled with its engine value as a percentage.
function ScoreBar({ name, hint, before, after }: { name: string; hint: string; before: number; after: number }) {
  const pct = (n: number) => Math.round(n * 100)
  return (
    <div className="score-bar">
      <dt>{name}<span className="bar-hint">{hint}</span></dt>
      <dd>
        <span className="bar-row"><span className="bar-tag">Test</span><span className="bar" aria-hidden="true"><span className="bar-fill is-before" style={{ width: `${pct(before)}%` }} /></span><span className="bar-value">{pct(before)}%</span></span>
        <span className="bar-row"><span className="bar-tag">Retest</span><span className="bar" aria-hidden="true"><span className="bar-fill" style={{ width: `${pct(after)}%` }} /></span><span className="bar-value">{pct(after)}%</span></span>
      </dd>
    </div>
  )
}

// ---------- level up ----------

// Shown after a strong retest when the subject has a harder difficulty. Looks it up in the subject index.
function LevelUp({ pack, onStartPack }: { pack: Pack; onStartPack: (pack: Pack) => void }) {
  const [next, setNext] = useState<{ id: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadIndex().then((index) => {
      const subject = index.subjects.find((s) => s.subject === pack.subject)
      const harder = subject && harderDifficulty(pack.difficulty, subject.packs)
      const id = harder && subject?.packs[harder]
      if (!cancelled && harder && id) setNext({ id, label: harder })
    }, () => { /* no index, no Level up button: nothing to tell the user */ })
    return () => { cancelled = true }
  }, [pack.subject, pack.difficulty])

  if (!next) return null

  async function start() {
    if (!next) return
    setBusy(true)
    try {
      onStartPack(await loadPack(next.id))
    } catch (error) {
      console.error(error)
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn level-up" onClick={start} disabled={busy}>
        Level up: try {next.label}
      </button>
      {failed && <p className="notice" role="status">The harder lesson didn't load. Try again in a moment.</p>}
    </>
  )
}
