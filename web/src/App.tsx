// The root of the app. There is no router: the flow is a list of screens and Next/Back move along it.
// What the user does along the way is kept in the session context (session.ts), which every screen can read.
import { useCallback, useEffect, useMemo, useState } from 'react'
import CanvasDemo from './canvas/CanvasDemo'
import PackInspector from './dev/PackInspector'
import AppHeader, { type Stage } from './screens/AppHeader'
import ErrorBoundary from './screens/ErrorBoundary'
import Reference from './screens/Reference'
import Report from './screens/Report'
import Retest from './screens/Retest'
import SubjectPicker from './screens/SubjectPicker'
import Teach from './screens/Teach'
import Test from './screens/Test'
import WeakSpots from './screens/WeakSpots'
import type { Pack } from './engine/types'
import { emptySession, SessionContext, type Session } from './session'
import './styles/screens.css'

type Screen = 'subjects' | 'reference' | 'test' | 'weakSpots' | 'teach' | 'retest' | 'report'

// The screens in order. Next moves one step forward, Back one step back.
const FLOW: Screen[] = ['subjects', 'reference', 'test', 'weakSpots', 'teach', 'retest', 'report']

// Which stage of the progress bar each screen belongs to (weak spots count as the start of the lesson).
const STAGE_OF: Record<Screen, Stage | null> = {
  subjects: null, reference: null, test: 'test', weakSpots: 'lesson', teach: 'lesson', retest: 'retest', report: 'report',
}

export default function App() {
  // Developer pages are picked by the URL and skip the normal flow (no hooks above this line).
  const params = new URLSearchParams(window.location.search)
  if (params.get('debug') === 'pack') return <PackInspector id={params.get('id')} />
  if (params.get('debug') === 'canvas') return <CanvasDemo />
  return <Flow />
}

function Flow() {
  const [screen, setScreen] = useState<Screen>('subjects')
  const [session, setSession] = useState<Session>(emptySession)

  const update = useCallback((changes: Partial<Session>) => setSession((s) => ({ ...s, ...changes })), [])
  const restart = useCallback(() => {
    // Starting over keeps the time limit the user chose; everything else is cleared.
    setSession((s) => ({ ...emptySession, soloSeconds: s.soloSeconds }))
    setScreen('subjects')
  }, [])
  // Level up on the report: a fresh session on the new pack, starting at its reference.
  const startPack = useCallback((pack: Pack) => {
    setSession((s) => ({ ...emptySession, pack, soloSeconds: s.soloSeconds }))
    setScreen('reference')
  }, [])
  const context = useMemo(() => ({ session, update, restart }), [session, update, restart])

  // Moves `by` screens along FLOW, staying inside the list.
  const move = (by: number) => setScreen((s) => FLOW[Math.min(FLOW.length - 1, Math.max(0, FLOW.indexOf(s) + by))])
  const next = () => move(1)
  const back = () => move(-1)

  // Every screen after the picker needs a pack, so without one the picker is shown.
  const current: Screen = session.pack ? screen : 'subjects'

  // The logo goes back to the subject picker. Mid-run that throws drawings away, so it asks first.
  const goHome = () => {
    if (STAGE_OF[current] === null || window.confirm('Leave this lesson and start over? Your drawings will be lost.')) restart()
  }

  // Mid-run, closing or reloading the tab would lose the drawings, so the browser asks first.
  const inRun = STAGE_OF[current] !== null
  useEffect(() => {
    if (!inRun) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inRun])

  // Each new screen starts at the top of the page (the report is long; the next screen shouldn't open halfway).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [current])

  return (
    <SessionContext.Provider value={context}>
      <AppHeader stage={STAGE_OF[current]} onHome={goHome} />
      {/* key={current} remounts the wrapper on every screen change, which replays its fade-in. */}
      <main key={current} className="screen-enter">
        <ErrorBoundary onReset={restart}>
          {current === 'subjects' && <SubjectPicker onNext={next} />}
          {current === 'reference' && <Reference onBack={back} onNext={next} />}
          {current === 'test' && <Test onBack={back} onNext={next} />}
          {current === 'weakSpots' && <WeakSpots onBack={back} onNext={next} />}
          {current === 'teach' && <Teach onBack={back} onNext={next} />}
          {current === 'retest' && <Retest onBack={back} onNext={next} />}
          {current === 'report' && <Report onBack={back} onStartPack={startPack} />}
        </ErrorBoundary>
      </main>
    </SessionContext.Provider>
  )
}
