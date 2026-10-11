// Developer page for checking a subject pack: open the app with ?debug=pack&id=<packId>.
// Shows the target image with the plan drawn over it (strokes numbered in lesson order and colored by tier,
// key points, labeled part boxes), plus the counts and the steps list.
import { useEffect, useState, type ReactNode } from 'react'
import type { Pack, PlanStroke, Point, Tier } from '../engine/types'
import { loadPack, resolveAsset } from '../lib/packs'
import './PackInspector.css'

const TIERS: Tier[] = ['construction', 'outline', 'structure', 'detail']
const TIER_LABELS: Record<Tier, string> = {
  construction: 'Construction', outline: 'Outline', structure: 'Structure', detail: 'Detail',
}
const BADGE_RADIUS = 13

type LoadState = { kind: 'loading' } | { kind: 'ready'; pack: Pack } | { kind: 'failed'; message: string }

// The strokes in the order the lesson draws them: step by step, then any strokes no step uses.
function planOrder(pack: Pack): PlanStroke[] {
  const byId = new Map(pack.strokes.map((s) => [s.id, s]))
  const ordered = pack.steps.flatMap((step) => step.strokeIds).map((id) => byId.get(id))
    .filter((s): s is PlanStroke => s !== undefined)
  const seen = new Set(ordered.map((s) => s.id))
  return [...new Set([...ordered, ...pack.strokes.filter((s) => !seen.has(s.id))])]
}

// Where each stroke's number badge goes: at its first point, nudged down while it would cover an earlier badge
// (two strokes often start at the same corner, like a head outline and an ear).
function badgePositions(strokes: PlanStroke[]): Point[] {
  const placed: Point[] = []
  for (const stroke of strokes) {
    let [x, y] = stroke.points[0] ?? [0, 0]
    while (placed.some(([px, py]) => Math.hypot(px - x, py - y) < BADGE_RADIUS * 2)) y += BADGE_RADIUS * 2
    placed.push([x, y])
  }
  return placed
}

const toPoints = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')

export default function PackInspector({ id }: { id: string | null }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    loadPack(id).then(
      (pack) => { if (!cancelled) setState({ kind: 'ready', pack }) },
      (error: unknown) => {
        // A developer page, so the loader's message (which names the broken field) is shown as is.
        if (!cancelled) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { cancelled = true }
  }, [id])

  if (!id) {
    return (
      <Frame>
        <p>Add a pack id to the URL, for example <code>?debug=pack&amp;id=demo-fox-medium</code>.</p>
      </Frame>
    )
  }
  if (state.kind === 'loading') return <Frame><p role="status">Loading pack "{id}"…</p></Frame>
  if (state.kind === 'failed') {
    return (
      <Frame>
        <p>Couldn't load pack "{id}":</p>
        <pre className="inspector-error">{state.message}</pre>
      </Frame>
    )
  }

  const { pack } = state
  const ordered = planOrder(pack)
  const number = new Map(ordered.map((s, i) => [s.id, i + 1]))
  const badges = badgePositions(ordered)

  return (
    <Frame>
      <div className="inspector">
        <div className="inspector-canvas">
          <img src={resolveAsset(pack, pack.target)} alt={`Target drawing of ${pack.title}`} width={768} height={768} />
          <svg viewBox={`0 0 ${pack.size} ${pack.size}`} aria-label="Plan strokes, key points and part boxes" role="img">
            {pack.parts.map((part) => {
              const [x, y, w, h] = part.box
              return (
                <g key={part.id} className="part">
                  <rect x={x} y={y} width={w} height={h} />
                  {/* The label sits above the box, or just inside it when the box touches the top edge. */}
                  <text x={x + 4} y={y > 24 ? y - 8 : y + 20}>{part.label}</text>
                </g>
              )
            })}
            {ordered.map((stroke) => (
              <g key={stroke.id} className={`plan-stroke tier-${stroke.tier}`}>
                <polyline points={toPoints(stroke.points)} />
                {stroke.keyPoints.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} />)}
              </g>
            ))}
            {ordered.map((stroke, i) => (
              <g key={stroke.id} className={`badge tier-${stroke.tier}`} transform={`translate(${badges[i][0]} ${badges[i][1]})`}>
                <circle r={BADGE_RADIUS} />
                <text dy="0.35em">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>

        <aside className="inspector-side">
          <section>
            <h2>{pack.title}</h2>
            <p className="inspector-muted">
              {pack.id} · {pack.difficulty} · {pack.source.kind}{pack.source.prompt ? `: "${pack.source.prompt}"` : ''}
            </p>
            <p className="inspector-counts">
              {pack.strokes.length} strokes · {pack.steps.length} steps · {pack.parts.length} parts
            </p>
          </section>

          <section>
            <h3>Tiers</h3>
            <ul className="inspector-legend">
              {TIERS.map((tier) => (
                <li key={tier}>
                  <span className={`swatch tier-${tier}`} aria-hidden="true" />
                  {TIER_LABELS[tier]}{tier === 'construction' ? ' (dashed)' : ''}:{' '}
                  {pack.strokes.filter((s) => s.tier === tier).length}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Steps</h3>
            <ol className="inspector-steps">
              {pack.steps.map((step) => (
                <li key={step.id}>
                  <strong>{step.label}</strong> <span className="inspector-muted">({TIER_LABELS[step.tier].toLowerCase()})</span>
                  <div className="inspector-muted">
                    {step.strokeIds.map((id) => `#${number.get(id)} ${id}`).join(', ')}
                  </div>
                  <div>{step.tip}</div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3>Parts</h3>
            <ul className="inspector-parts">
              {pack.parts.map((part) => (
                <li key={part.id}>
                  {part.label} <span className="inspector-muted">[{part.box.join(', ')}]</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="inspector-page">
      <h1>Pack inspector</h1>
      {children}
    </main>
  )
}
