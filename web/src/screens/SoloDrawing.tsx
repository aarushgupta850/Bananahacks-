// Placeholder for the two solo rounds, the test and the retest: the reference beside a canvas, no help.
// One component for both (as in Jeff's J2b), so they stay the same. J2b adds the 45 s countdown, undo and pen sizes.
import { engine } from '../engine'
import type { UserStroke } from '../engine/types'
import DrawingCanvas from '../canvas/DrawingCanvas'
import { resolveAsset } from '../lib/packs'
import { usePack, useSession } from '../session'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

const TEXT = {
  test: { title: 'Test', lead: 'Copy the drawing on your own in 45 seconds. We measure your proportions, shapes and lines.' },
  retest: { title: 'Retest', lead: 'Draw it once more on your own, with no help, so we can measure what changed.' },
}

export default function SoloDrawing({ round, onBack, onNext }: NavProps & { round: 'test' | 'retest' }) {
  const pack = usePack()
  const { session, update } = useSession()
  const strokes = round === 'test' ? session.testStrokes : session.retestStrokes

  function addStroke(stroke: UserStroke) {
    const all = [...strokes, stroke]
    update(round === 'test' ? { testStrokes: all } : { retestStrokes: all })
  }

  function finish() {
    const analysis = engine.analyze(pack, strokes)
    update(round === 'test' ? { testAnalysis: analysis } : { retestAnalysis: analysis })
    onNext()
  }

  return (
    <PlaceholderScreen title={TEXT[round].title} lead={TEXT[round].lead} onBack={onBack} onNext={finish} nextLabel="Done">
      {/* The reference sits beside the canvas, never on it: copying, not tracing. */}
      <div className="solo-layout">
        <figure className="solo-reference">
          <img src={resolveAsset(pack, pack.target)} alt={`${pack.title}: the drawing to copy`} width={768} height={768} />
          <figcaption>Reference</figcaption>
        </figure>
        <div className="canvas-stack">
          <DrawingCanvas strokes={strokes} onStroke={addStroke} />
        </div>
      </div>
    </PlaceholderScreen>
  )
}
