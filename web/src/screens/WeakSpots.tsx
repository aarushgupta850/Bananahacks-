// Placeholder: the 2 or 3 things the test found to work on. Jeff's J2b designs the cards.
import { engine } from '../engine'
import { usePack, useSession } from '../session'
import PlaceholderScreen, { type NavProps } from './PlaceholderScreen'

export default function WeakSpots({ onBack, onNext }: NavProps) {
  const pack = usePack()
  const { session, update } = useSession()

  function next() {
    // The Test screen always stores an analysis before coming here.
    if (session.testAnalysis) update({ weaknesses: engine.findWeaknesses(pack, session.testAnalysis) })
    onNext()
  }

  return (
    <PlaceholderScreen
      title="Weak spots"
      lead="We'll show the two or three things to fix first, plus one thing you already do well."
      onBack={onBack}
      onNext={next}
      nextLabel="Start the lesson"
    />
  )
}
