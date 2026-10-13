// The two solo rounds, the test and the retest: the reference BESIDE the canvas (never on it), the time limit
// chosen on the Reference screen (or none), no help. One component for both so they stay identical, which keeps the before/after comparison fair.
// When the round ends (Done, Skip or the timer) the engine analyzes the strokes and the session keeps the result.
import { useCallback, useEffect, useRef, useState } from 'react'
import CanvasToolbar from '../canvas/CanvasToolbar'
import DrawingCanvas from '../canvas/DrawingCanvas'
import ExportStrokesButton from '../canvas/ExportStrokesButton'
import type { PenSize } from '../canvas/geometry'
import { engine } from '../engine'
import type { UserStroke } from '../engine/types'
import { resolveAsset } from '../lib/packs'
import { usePack, useSession } from '../session'
import CountdownRing from './CountdownRing'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'
import { useCountdown } from './useCountdown'

const TEXT = {
  test: { title: 'Test', lead: 'Copy the drawing on your own. No help yet: we measure where you start.' },
  retest: { title: 'Retest', lead: 'Draw it once more on your own, with no help, so we can measure what changed.' },
}

export default function SoloDrawing({ round, onBack, onNext }: NavProps & { round: 'test' | 'retest' }) {
  const pack = usePack()
  const { session, update } = useSession()
  const strokes = round === 'test' ? session.testStrokes : session.retestStrokes
  const [penSize, setPenSize] = useState<PenSize>('medium')
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')

  // The latest strokes, for finish() when the timer calls it (it may run from an old render).
  const latest = useRef(strokes)
  useEffect(() => {
    latest.current = strokes
  }, [strokes])
  const finished = useRef(false) // Done and the timer can both fire; only the first one counts

  const setStrokes = (next: UserStroke[]) => update(round === 'test' ? { testStrokes: next } : { retestStrokes: next })

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    const analysis = engine.analyze(pack, latest.current)
    update(round === 'test' ? { testAnalysis: analysis } : { retestAnalysis: analysis })
    onNext()
  }, [pack, round, update, onNext])

  // Both rounds use the same limit from the session. With no limit the clock never runs and only Done ends the round.
  const limit = session.soloSeconds
  const remaining = useCountdown(limit ?? 0, finish, limit !== null)

  return (
    <PlaceholderScreen
      compact
      title={TEXT[round].title}
      lead={TEXT[round].lead}
      onBack={round === 'test' ? onBack : undefined}
      onNext={finish}
      nextLabel="Done"
      extraActions={
        <>
          <ExportStrokesButton strokes={strokes} fileName={`${pack.id}-${round}`} />
          <button type="button" className="btn btn-quiet" onClick={finish}>Skip</button>
        </>
      }
    >
      <div className="solo-layout">
        <aside className="solo-side">
          {limit !== null && <CountdownRing remaining={remaining} total={limit} />}
          {/* The reference sits beside the canvas, never on it: copying, not tracing. */}
          <figure className="solo-reference">
            <img src={resolveAsset(pack, pack.target)} alt={`${pack.title}: the drawing to copy`} width={768} height={768} />
            <figcaption>Reference</figcaption>
          </figure>
        </aside>
        <div className="canvas-column">
          <div className="canvas-stack">
            <DrawingCanvas
              strokes={strokes}
              onStroke={(stroke) => setStrokes([...strokes, stroke])}
              penSize={penSize}
              tool={tool}
              onErase={setStrokes}
              label={`${TEXT[round].title} canvas. Copy the reference here.`}
            />
          </div>
          <CanvasToolbar
            penSize={penSize}
            onPenSize={setPenSize}
            onUndo={() => setStrokes(strokes.slice(0, -1))}
            onClear={() => setStrokes([])}
            canUndo={strokes.length > 0}
            tool={tool}
            onTool={setTool}
          />
        </div>
      </div>
    </PlaceholderScreen>
  )
}
