// Placeholder for the report card: test and retest side by side, measured by the engine. Jeff's J3 builds it.
import { useState } from 'react'
import { usePack, useSession } from '../session'
import PipelinePanel from './PipelinePanel'
import PlaceholderScreen from './PlaceholderScreen'

export default function Report({ onBack }: { onBack: () => void }) {
  const pack = usePack()
  const { restart } = useSession()
  const [showPipeline, setShowPipeline] = useState(false)

  return (
    <PlaceholderScreen
      title="Report"
      lead="Your test and retest side by side, with the scores and coaching the engine measured."
      onBack={onBack}
      extraActions={
        <>
          <button type="button" className="btn" onClick={() => setShowPipeline(true)}>How this lesson was made</button>
          <button type="button" className="btn btn-primary" onClick={restart}>Try another subject</button>
        </>
      }
    >
      <PipelinePanel pack={pack} open={showPipeline} onClose={() => setShowPipeline(false)} />
    </PlaceholderScreen>
  )
}
