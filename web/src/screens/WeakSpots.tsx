// Screen 4: the 2 or 3 things the test found to work on, each with a small picture, plus one strength.
// It stays until the user presses "Start the lesson", so there's time to read every card.
// Every message and number here comes from the engine (findWeaknesses and the test analysis).
import { useState } from 'react'
import { engine } from '../engine'
import type { PartMetric, Weakness } from '../engine/types'
import { usePack, useSession } from '../session'
import PartCompare from './PartCompare'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

const KIND_NAMES: Record<Weakness['kind'], string> = {
  size: 'Size', position: 'Position', shape: 'Shape', missing: 'Missing', line: 'Line quality',
}

export default function WeakSpots({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()
  const analysis = session.testAnalysis

  // Worked out once when the screen opens. The Test screen always stores an analysis before coming here.
  const [weaknesses] = useState<Weakness[]>(() => (analysis ? engine.findWeaknesses(pack, analysis) : []))
  // One thing they already do well: the first part the engine marked good.
  const strength: PartMetric | undefined = analysis?.parts.find((p) => p.good && !p.missing)

  function next() {
    update({ weaknesses })
    onNext()
  }

  const yours = analysis?.alignedStrokes ?? [] // the test drawing, lined up with the target by the engine
  const userBox = (partId: string | null) => analysis?.parts.find((p) => p.partId === partId)?.userBox ?? null

  return (
    <PlaceholderScreen
      title="Your weak spots"
      lead="Your lesson starts with these."
      onBack={onBack}
      onNext={next}
      nextLabel="Start the lesson"
    >
      <div className="weak-grid">
        {weaknesses.length === 0 && (
          <article className="weak-card is-good">
            <span className="card-tag">Nice</span>
            <h2>No big problems found</h2>
            <p>The lesson will still walk you through it step by step.</p>
          </article>
        )}
        {weaknesses.map((w, i) => (
          <article key={`${w.kind}-${w.partId ?? 'all'}-${i}`} className="weak-card">
            <span className="card-tag">{KIND_NAMES[w.kind]}</span>
            {w.partId !== null
              ? <PartCompare pack={pack} partId={w.partId} user={userBox(w.partId)} yours={yours} label={labelOf(pack.parts, w.partId)} />
              : <LineSample />}
            <p className="weak-message">{w.message}</p>
          </article>
        ))}
        {strength && (
          <article className="weak-card is-good">
            <span className="card-tag">✓ Already good</span>
            <PartCompare pack={pack} partId={strength.partId} user={strength.userBox} yours={yours} label={strength.label.toLowerCase()} />
            <p className="weak-message">{strength.label}: in proportion. Keep it up.</p>
          </article>
        )}
      </div>
    </PlaceholderScreen>
  )
}

function labelOf(parts: { id: string; label: string }[], partId: string): string {
  return (parts.find((p) => p.id === partId)?.label ?? 'part').toLowerCase()
}

// For line-quality weaknesses (no part): a shaky line next to a confident one, both labeled.
function LineSample() {
  return (
    <svg className="part-compare" viewBox="0 0 200 120" role="img" aria-label="A hesitant, sketchy line compared with a single confident line">
      <path className="compare-user-line" d="M20 40 l15 -4 l-6 3 l18 -2 l-5 4 l20 -3 l-4 2 l22 -4 l-6 3 l25 -2 l-3 3 l30 -3" />
      <text x="20" y="62" fontSize="13">hesitant</text>
      <path className="compare-target-line" d="M20 95 Q100 75 180 92" />
      <text x="20" y="115" fontSize="13">confident</text>
    </svg>
  )
}
