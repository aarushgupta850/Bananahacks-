// "Your progress" on the subject picker: how the user's scores have moved across sessions, saved in this
// browser by lib/progress.ts. Hidden until at least one session is finished. Every number shown is an
// engine score from a past report, or a sum/average of those (worked out in lib/progress.ts).
import { useEffect, useRef, useState } from 'react'
import {
  clearHistory, computeStats, formatGain, gainOf, loadHistory, relativeDay, type ProgressRecord,
} from '../lib/progress'
import '../styles/progress.css'

const RECENT_COUNT = 4     // sessions in the recent list
const SPARK_COUNT = 12     // sessions in the sparkline

const DIFFICULTY_LABEL = { simple: 'Simple', medium: 'Medium', detailed: 'Detailed' } as const

export default function ProgressPanel() {
  // Read once when the screen opens; a session can only be added from the report screen.
  const [history, setHistory] = useState<ProgressRecord[]>(() => loadHistory())
  const [now] = useState(() => Date.now()) // "today" for the streak and the dates, fixed while the screen is open
  const [confirming, setConfirming] = useState(false)
  const [cleared, setCleared] = useState(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const clearButton = useRef<HTMLButtonElement>(null)
  const firstRender = useRef(true)

  // Move focus into the confirm step when it opens, and back to "Clear history" when it closes.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (confirming) cancelButton.current?.focus()
    else clearButton.current?.focus()
  }, [confirming])

  if (cleared) return <p className="progress-cleared" role="status">Your progress history was cleared.</p>
  if (history.length === 0) return null

  const stats = computeStats(history, now)
  const recent = history.slice(-RECENT_COUNT).reverse()

  function clear() {
    clearHistory()
    setHistory([])
    setConfirming(false)
    setCleared(true)
  }

  return (
    <section className="progress" aria-labelledby="progress-title">
      <header className="progress-head">
        <h2 id="progress-title">Your progress</h2>
        {confirming ? (
          <div className="progress-confirm" role="group" aria-label="Confirm clearing history">
            <span>Delete all {stats.sessions} saved {stats.sessions === 1 ? 'lesson' : 'lessons'}?</span>
            <button type="button" className="text-btn is-danger" onClick={clear}>Yes, clear</button>
            <button type="button" className="text-btn" ref={cancelButton} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="text-btn" ref={clearButton} onClick={() => setConfirming(true)}>Clear history</button>
        )}
      </header>

      {/* Left: the numbers and the chart. Right: the latest lessons. Stacks on narrow screens. */}
      <div className="progress-layout">
        <div className="progress-overview">
          {/* After one lesson, "average" and "best" would both just repeat its gain, so one Gain tile shows instead. */}
          <dl className={stats.sessions === 1 ? 'progress-stats is-row' : 'progress-stats'}>
            <Stat label="Lessons" value={String(stats.sessions)} note="finished" />
            {stats.sessions === 1 ? (
              <Stat label="Gain" value={formatGain(stats.bestGain)} note="points" />
            ) : (
              <>
                <Stat label="Average gain" value={formatGain(stats.averageGain)} note="points per lesson" />
                <Stat label="Best gain" value={formatGain(stats.bestGain)} note="points in one lesson" />
              </>
            )}
            <Stat label="Day streak" value={String(stats.streak)} note={stats.streak === 1 ? 'day' : 'days in a row'} />
          </dl>
          {history.length >= 2 && <Sparkline records={history.slice(-SPARK_COUNT)} />}
        </div>

        <div className="progress-recent-block">
          <h3 className="progress-subhead" id="progress-recent-title">Recent lessons</h3>
          <ol className="progress-recent" aria-labelledby="progress-recent-title">
            {recent.map((r, i) => <RecentItem key={r.id} record={r} now={now} index={i} />)}
          </ol>
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="progress-stat">
      <dt>{label}</dt>
      <dd>
        <span className="progress-stat-value">{value}</span>
        {note && <span className="progress-stat-note">{note}</span>}
      </dd>
    </div>
  )
}

// The change for one session, in words as well as color: "+12 better", "±0 same", "−4 lower".
function GainChip({ gain }: { gain: number }) {
  const kind = gain > 0 ? 'is-up' : gain < 0 ? 'is-down' : 'is-flat'
  const word = gain > 0 ? 'better' : gain < 0 ? 'lower' : 'same'
  return (
    <span className={`gain-chip ${kind}`}>
      {formatGain(gain)} <span className="gain-word">{word}</span>
    </span>
  )
}

function RecentItem({ record, now, index }: { record: ProgressRecord; now: number; index: number }) {
  return (
    <li className="recent-item" style={{ animationDelay: `${120 + index * 50}ms` }}>
      <span className="recent-thumb">
        {record.thumb
          ? <img src={record.thumb} alt="" width={56} height={56} loading="lazy" />
          : <span className="recent-initial" aria-hidden="true">{record.title.charAt(0)}</span>}
      </span>
      <span className="recent-text">
        <span className="recent-title">{record.title}</span>
        <span className="recent-meta">{DIFFICULTY_LABEL[record.difficulty]} · {relativeDay(record.at, now)}</span>
      </span>
      <span className="recent-result">
        <span className="recent-scores" aria-label={`Test ${record.testScore}, retest ${record.retestScore}`}>
          <span>{record.testScore}</span>
          <span className="recent-arrow" aria-hidden="true">→</span>
          <strong>{record.retestScore}</strong>
        </span>
        <GainChip gain={gainOf(record)} />
      </span>
    </li>
  )
}

// A tiny chart of test (dashed, like a ghost line) and retest (solid) scores, oldest on the left.
// Scores are 0-100, so the y axis is fixed at 0-100 and lines from different sessions compare fairly.
const W = 520
const H = 84
const PAD = 6

function Sparkline({ records }: { records: ProgressRecord[] }) {
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, records.length - 1)
  const y = (score: number) => PAD + ((100 - Math.max(0, Math.min(100, score))) * (H - 2 * PAD)) / 100
  const line = (scores: number[]) => scores.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(s).toFixed(1)}`).join(' ')
  const tests = records.map((r) => r.testScore)
  const retests = records.map((r) => r.retestScore)
  const first = retests[0]
  const last = retests[retests.length - 1]
  const summary = `Retest scores over your last ${records.length} lessons, from ${first} to ${last}.`

  return (
    <figure className="progress-spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {/* Faint guides at 50 and 100 points. */}
        <line className="spark-grid" x1={PAD} x2={W - PAD} y1={y(50)} y2={y(50)} />
        <line className="spark-grid" x1={PAD} x2={W - PAD} y1={y(100)} y2={y(100)} />
        <path className="spark-test" d={line(tests)} />
        <path className="spark-retest" d={line(retests)} pathLength={1} />
        <circle className="spark-dot" cx={x(retests.length - 1)} cy={y(last)} r={4.5} />
      </svg>
      <figcaption>
        <span className="spark-key is-retest">Retest</span>
        <span className="spark-key is-test">Test</span>
        <span className="spark-range">last {records.length} lessons, out of 100</span>
      </figcaption>
    </figure>
  )
}
