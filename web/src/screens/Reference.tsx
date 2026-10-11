// Placeholder: shows the drawing to copy before the test. Jeff's J2a designs it.
import { useState } from 'react'
import { resolveAsset } from '../lib/packs'
import { usePack } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

export default function Reference({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const [showPipeline, setShowPipeline] = useState(false)

  return (
    <PlaceholderScreen
      title="Reference"
      lead="First, copy this as best you can. No help yet."
      onBack={onBack}
      onNext={onNext}
      nextLabel="Start test"
      extraActions={
        <button type="button" className="btn" onClick={() => setShowPipeline(true)}>How this lesson was made</button>
      }
    >
      <img
        className="reference-image"
        src={resolveAsset(pack, pack.target)}
        alt={`${pack.title}: the drawing to copy`}
        width={768}
        height={768}
      />
      <PipelinePanel pack={pack} open={showPipeline} onClose={() => setShowPipeline(false)} />
    </PlaceholderScreen>
  )
}
