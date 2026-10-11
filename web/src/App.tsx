// The root of the app. There is no router: the flow is a list of screens and Next/Back move along it.
// What the user does along the way is kept in the session context (session.ts), which every screen can read.
import { useCallback, useMemo, useState } from 'react'
import PackInspector from './dev/PackInspector'
import Reference from './screens/Reference'
import Report from './screens/Report'
import Retest from './screens/Retest'
import SubjectPicker from './screens/SubjectPicker'
import Teach from './screens/Teach'
import Test from './screens/Test'
import WeakSpots from './screens/WeakSpots'
import { emptySession, SessionContext, type Session } from './session'
import './styles/screens.css'

type Screen = 'subjects' | 'reference' | 'test' | 'weakSpots' | 'teach' | 'retest' | 'report'

// The screens in order. Next moves one step forward, Back one step back.
const FLOW: Screen[] = ['subjects', 'reference', 'test', 'weakSpots', 'teach', 'retest', 'report']

export default function App() {
  // Developer pages are picked by the URL and skip the normal flow (no hooks above this line).
  const params = new URLSearchParams(window.location.search)
  if (params.get('debug') === 'pack') return <PackInspector id={params.get('id')} />
  return <Flow />
}

function Flow() {
  const [screen, setScreen] = useState<Screen>('subjects')
  const [session, setSession] = useState<Session>(emptySession)

  const update = useCallback((changes: Partial<Session>) => setSession((s) => ({ ...s, ...changes })), [])
  const restart = useCallback(() => {
    setSession(emptySession)
    setScreen('subjects')
  }, [])
  const context = useMemo(() => ({ session, update, restart }), [session, update, restart])

  // Moves `by` screens along FLOW, staying inside the list.
  const move = (by: number) => setScreen((s) => FLOW[Math.min(FLOW.length - 1, Math.max(0, FLOW.indexOf(s) + by))])
  const next = () => move(1)
  const back = () => move(-1)

  // Every screen after the picker needs a pack, so without one the picker is shown.
  const current: Screen = session.pack ? screen : 'subjects'

  return (
    <SessionContext.Provider value={context}>
      <main>
        {current === 'subjects' && <SubjectPicker onNext={next} />}
        {current === 'reference' && <Reference onBack={back} onNext={next} />}
        {current === 'test' && <Test onBack={back} onNext={next} />}
        {current === 'weakSpots' && <WeakSpots onBack={back} onNext={next} />}
        {current === 'teach' && <Teach onBack={back} onNext={next} />}
        {current === 'retest' && <Retest onBack={back} onNext={next} />}
        {current === 'report' && <Report onBack={back} />}
      </main>
    </SessionContext.Provider>
  )
}
