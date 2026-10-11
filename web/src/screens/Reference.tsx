// Screen 2: the drawing to copy, shown large before the test, with a way into "How this lesson was made".
import { useState } from 'react'
import { resolveAsset } from '../lib/packs'
import { usePack, useSession } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'
import TimeLimitPicker from './TimeLimitPicker'
import { withinPhrase } from './timeLimit'

const LEVEL_NAMES = { simple: 'Simple', medium: 'Medium', detailed: 'Detailed' } as const

export default function Reference({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()
  const [showPipeline, setShowPipeline] = useState(false)
  const [timeValid, setTimeValid] = useState(true) // false while a custom time is being typed and isn't valid
  const { soloSeconds } = session

  return (
    <PlaceholderScreen
      title={pack.title}
      lead="First, copy this as best you can. No help yet."
      onBack={onBack}
      backLabel="Choose another"
      onNext={onNext}
      nextLabel="Start test"
      nextDisabled={!timeValid}
      extraActions={
        <button type="button" className="btn" onClick={() => setShowPipeline(true)}>How this lesson was made</button>
      }
    >
      <div className="reference-layout">
        <figure className="reference-figure">
          <img
            className="reference-image"
            src={resolveAsset(pack, pack.target)}
            alt={`${pack.title}: the drawing to copy`}
            width={768}
            height={768}
          />
          <figcaption>
            <span className="chip">{LEVEL_NAMES[pack.difficulty]}</span>
            {pack.source.kind === 'photo' ? 'Made by image AI from a photo' : 'Made by image AI'}
          </figcaption>
        </figure>
        <div className="reference-side">
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
