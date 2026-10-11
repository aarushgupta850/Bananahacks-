// Screen 2: the drawing to copy, shown large before the test, with a way into "How this lesson was made".
import { useState } from 'react'
import { resolveAsset } from '../lib/packs'
import { usePack } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

const LEVEL_NAMES = { simple: 'Simple', medium: 'Medium', detailed: 'Detailed' } as const

export default function Reference({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const [showPipeline, setShowPipeline] = useState(false)

  return (
    <PlaceholderScreen
      title={pack.title}
      lead="First, copy this as best you can. No help yet."
      onBack={onBack}
      backLabel="Choose another"
      onNext={onNext}
      nextLabel="Start test"
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
        <ol className="flow-steps" aria-label="What happens next">
          <li><strong>Test.</strong> Copy it on your own in 45 seconds. The reference stays beside the canvas.</li>
          <li><strong>Weak spots.</strong> We measure your proportions, shapes and lines.</li>
          <li><strong>Lesson.</strong> Ghost lines guide you, and fade as you get it right.</li>
          <li><strong>Retest.</strong> Draw it again on your own, and see what improved.</li>
        </ol>
      </div>
      <PipelinePanel pack={pack} open={showPipeline} onClose={() => setShowPipeline(false)} />
    </PlaceholderScreen>
  )
}
