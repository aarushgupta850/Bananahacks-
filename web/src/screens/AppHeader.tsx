// The bar at the top of every screen: the app name (which also restarts) and where the user is in the run.
// The current stage is marked in text (aria-current and bold), not only by color.
type Stage = 'test' | 'lesson' | 'retest' | 'report'

const STAGES: { id: Stage; label: string }[] = [
  { id: 'test', label: 'Test' },
  { id: 'lesson', label: 'Lesson' },
  { id: 'retest', label: 'Retest' },
  { id: 'report', label: 'Report' },
]

interface AppHeaderProps {
  stage: Stage | null // null on the subject picker and reference (nothing started yet)
  onHome: () => void
}

export type { Stage }

export default function AppHeader({ stage, onHome }: AppHeaderProps) {
  const at = stage ? STAGES.findIndex((s) => s.id === stage) : -1
  return (
    <header className="app-header">
      <button type="button" className="brand" onClick={onHome} aria-label="Ghost Lines: start over">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
        <span>Ghost Lines</span>
      </button>
      {stage && (
        <ol className="stage-track" aria-label="Your progress">
          {STAGES.map((s, i) => (
            <li
              key={s.id}
              className={i < at ? 'is-done' : i === at ? 'is-current' : ''}
              aria-current={i === at ? 'step' : undefined}
            >
              <span className="stage-dot" aria-hidden="true">{i < at ? '✓' : i + 1}</span>
              <span className="stage-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </header>
  )
}
