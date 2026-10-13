// A plain frame shared by the placeholder screens: a title, one sentence, the screen's content, and Back/Next.
// Jeff replaces the placeholders with the designed screens (playbook J2a-J3).
import { useEffect, useRef, type ReactNode } from 'react'
import { clickCounts } from './clickGuard'

// What App.tsx gives every screen: move one step forward or back in the flow.
export interface NavProps {
  onBack: () => void
  onNext: () => void
}

interface PlaceholderScreenProps {
  title: string
  lead: string             // one sentence about what the screen does
  children?: ReactNode
  onBack?: () => void      // no Back button when missing
  onNext?: () => void      // no Next button when missing
  backLabel?: string
  nextLabel?: string
  nextDisabled?: boolean   // shows Next but greyed out (e.g. while a form value is invalid)
  extraActions?: ReactNode // more buttons, placed before Next
  compact?: boolean        // drawing screens: smaller heading so the canvas and buttons fit on a laptop screen
}

export default function PlaceholderScreen({
  title, lead, children, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', extraActions, compact = false, nextDisabled = false,
}: PlaceholderScreenProps) {
  // Move focus to the heading on every new screen, so keyboard and screen-reader users start at the top.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  // When the screen appeared, so the second click of a double-click on the previous screen's main button doesn't
  // also press this one (see clickGuard.ts).
  const shownAt = useRef(performance.now())
  const next = () => {
    if (clickCounts(shownAt.current, performance.now())) onNext?.()
  }

  return (
    <section className={compact ? 'screen is-compact' : 'screen'} aria-labelledby="screen-title">
      <header className="screen-intro">
        <h1 id="screen-title" ref={heading} tabIndex={-1}>{title}</h1>
        <p className="screen-lead">{lead}</p>
      </header>
      {children && <div className="screen-body">{children}</div>}
      <nav className="screen-nav" aria-label="Screen navigation">
        {onBack && <button type="button" className="btn" onClick={onBack}>{backLabel}</button>}
        <div className="screen-nav-end">
          {extraActions}
          {onNext && <button type="button" className="btn btn-primary" onClick={next} disabled={nextDisabled}>{nextLabel}</button>}
        </div>
      </nav>
    </section>
  )
}
