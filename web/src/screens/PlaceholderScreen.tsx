// A plain frame shared by the placeholder screens: a title, one sentence, the screen's content, and Back/Next.
// Jeff replaces the placeholders with the designed screens (playbook J2a-J3).
import { useEffect, useRef, type ReactNode } from 'react'

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
  extraActions?: ReactNode // more buttons, placed before Next
}

export default function PlaceholderScreen({
  title, lead, children, onBack, onNext, backLabel = 'Back', nextLabel = 'Next', extraActions,
}: PlaceholderScreenProps) {
  // Move focus to the heading on every new screen, so keyboard and screen-reader users start at the top.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section className="screen" aria-labelledby="screen-title">
      <header className="screen-intro">
        <h1 id="screen-title" ref={heading} tabIndex={-1}>{title}</h1>
        <p className="screen-lead">{lead}</p>
      </header>
      {children && <div className="screen-body">{children}</div>}
      <nav className="screen-nav" aria-label="Screen navigation">
        {onBack && <button type="button" className="btn" onClick={onBack}>{backLabel}</button>}
        <div className="screen-nav-end">
          {extraActions}
          {onNext && <button type="button" className="btn btn-primary" onClick={onNext}>{nextLabel}</button>}
        </div>
      </nav>
    </section>
  )
}
