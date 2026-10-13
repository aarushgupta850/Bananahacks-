// Screen 2: the drawing to copy, shown large before the test, with a way into "How this lesson was made".
// For a lesson live AI made (a typed subject or a photo), "Draw a new one" asks for another drawing of the same thing.
import { useState } from 'react'
import { generate, LiveError } from '../lib/live'
import { resolveAsset } from '../lib/packs'
import { emptySession, usePack, useSession } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'
import { liveWaitText, useSecondsSince } from './liveWait'
import { REDRAW_FAILED, redrawApology, redrawNote } from './redraw'
import SketchLoader from './SketchLoader'
import TimeLimitPicker from './TimeLimitPicker'
import { withinPhrase } from './timeLimit'

const LEVEL_NAMES = { simple: 'Simple', medium: 'Medium', detailed: 'Detailed' } as const

export default function Reference({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()
  const [showPipeline, setShowPipeline] = useState(false)
  const [timeValid, setTimeValid] = useState(true) // false while a custom time is being typed and isn't valid
  const { soloSeconds, liveRequest } = session
  // "Draw a new one": idle, drawing (waiting = someone else's drawing goes first) or failed with a message.
  const [redraw, setRedraw] = useState<{ kind: 'idle' } | { kind: 'drawing'; waiting: boolean } | { kind: 'failed'; message: string }>({ kind: 'idle' })
  const [drawings, setDrawings] = useState(1) // how many drawings this subject has had, counting the first
  const drawing = redraw.kind === 'drawing'
  const waited = useSecondsSince(drawing)
  // Only before the test: after it, a new drawing would make the before/after comparison meaningless.
  const canRedraw = liveRequest !== null && session.testAnalysis === null

  async function drawAgain() {
    if (!liveRequest || drawing) return
    setRedraw({ kind: 'drawing', waiting: false })
    try {
      // The server picks a new random seed on every request, so the same request gives a new drawing.
      const next = await generate(liveRequest, () => setRedraw({ kind: 'drawing', waiting: true }))
      update({ ...emptySession, pack: next, soloSeconds, liveRequest })
      setDrawings((n) => n + 1)
      setRedraw({ kind: 'idle' })
    } catch (error) {
      console.error(error) // the details are for developers; users get a friendly message
      setRedraw({ kind: 'failed', message: REDRAW_FAILED[error instanceof LiveError ? error.kind : 'failed'] })
    }
  }

  return (
    <PlaceholderScreen
      title={pack.title}
      lead="First, copy this as best you can. No help yet."
      onBack={drawing ? undefined : onBack}
      backLabel="Choose another"
      onNext={onNext}
      nextLabel="Start test"
      nextDisabled={!timeValid || drawing}
      extraActions={
        <button type="button" className="btn" onClick={() => setShowPipeline(true)}>How this lesson was made</button>
      }
    >
      <div className="reference-layout">
        <figure className="reference-figure">
          {drawing ? (
            <div className="reference-image reference-redrawing">
              <SketchLoader text={liveWaitText(waited, redraw.waiting)} />
            </div>
          ) : (
            <img
              className="reference-image"
              src={resolveAsset(pack, pack.target)}
              alt={`${pack.title}: the drawing to copy`}
              width={768}
              height={768}
            />
          )}
          <figcaption>
            <span className="chip">{LEVEL_NAMES[pack.difficulty]}</span>
            {pack.source.kind === 'photo' ? 'Made by image AI from a photo' : 'Made by image AI'}
          </figcaption>
        </figure>
        <div className="reference-side">
          {canRedraw && (
            <div className="redraw-card">
              <p>{redrawApology(pack.source.kind === 'photo')}</p>
              <button type="button" className="btn" onClick={drawAgain} disabled={drawing} aria-describedby="redraw-note">
                {drawing ? 'Drawing\u2026' : 'Draw a new one'}
              </button>
              <p id="redraw-note" className="redraw-note">{redrawNote(drawings)}</p>
              {redraw.kind === 'failed' && <p className="notice" role="status">{redraw.message}</p>}
            </div>
          )}
          <ol className="flow-steps" aria-label="What happens next">
            <li><strong>Test.</strong> Copy it on your own {withinPhrase(soloSeconds)}. The reference stays beside the canvas.</li>
            <li><strong>Weak spots.</strong> We measure your proportions, shapes and lines.</li>
            <li><strong>Lesson.</strong> Ghost lines guide you, and fade as you get it right.</li>
            <li><strong>Retest.</strong> Draw it again on your own, {soloSeconds === null ? 'again with no time limit' : 'with the same time'}, and see what improved.</li>
          </ol>
          {/* Locked once the test is done, so the retest always gets the same time as the test. */}
          <TimeLimitPicker
            value={soloSeconds}
            onChange={(seconds) => update({ soloSeconds: seconds })}
            onValidityChange={setTimeValid}
            locked={session.testAnalysis !== null}
          />
        </div>
      </div>
      <PipelinePanel pack={pack} open={showPipeline} onClose={() => setShowPipeline(false)} />
    </PlaceholderScreen>
  )
}
