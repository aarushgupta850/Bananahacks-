// Test page for the canvas pieces, opened with ?debug=canvas (add &dev=1 for the export button).
// Draw on the demo fox: the engine's teacher answers every stroke with ghosts, and the strokes are recorded
// so the replay player below can play them back.
import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine'
import type { Ghost, Pack, Teacher, UserStroke } from '../engine/types'
import { loadPack } from '../lib/packs'
import type { TeachRecording } from '../session'
import CanvasToolbar from './CanvasToolbar'
import DrawingCanvas from './DrawingCanvas'
import ExportStrokesButton from './ExportStrokesButton'
import GhostLayer from './GhostLayer'
import ReplayPlayer from './ReplayPlayer'
import type { PenSize } from './geometry'

const DEMO_PACK = 'demo-fox-medium'

export default function CanvasDemo() {
  const [pack, setPack] = useState<Pack | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    loadPack(DEMO_PACK).then(setPack, (error: unknown) => {
      console.error(error)
      setFailed(true)
    })
  }, [])

  if (failed) return <p className="notice">The demo fox didn't load. Check that the dev server is running.</p>
  if (!pack) return <p role="status">Loading the demo fox…</p>
  return <Demo pack={pack} />
}

function Demo({ pack }: { pack: Pack }) {
  // The first teacher is made once; Clear swaps in a fresh one.
  const [firstTeacher] = useState<Teacher>(() => engine.createTeacher(pack, pack.steps, 'guided'))
  const teacher = useRef<Teacher>(firstTeacher)
  const [startGhosts] = useState<Ghost[]>(() => firstTeacher.state().ghosts)
  const [ghosts, setGhosts] = useState<Ghost[]>(startGhosts)
  const [strokes, setStrokes] = useState<UserStroke[]>([])
  const [penSize, setPenSize] = useState<PenSize>('medium')
  const [recording, setRecording] = useState<TeachRecording>({ events: [] })
  const startedAt = useRef(0) // performance.now() when the page opened (set in the effect below)

  // The recording's clock starts when the page opens.
  useEffect(() => {
    startedAt.current = performance.now()
  }, [])

  function handleStroke(stroke: UserStroke) {
    const result = teacher.current.addStroke(stroke)
    const t = Math.round(performance.now() - startedAt.current)
    setStrokes((s) => [...s, stroke])
    setGhosts(result.ghosts)
    setRecording((r) => ({ events: [...r.events, { t, type: 'stroke', stroke }, { t, type: 'ghosts', ghosts: result.ghosts }] }))
  }

  // Starts over: a fresh teacher, no strokes, an empty recording.
  function clear() {
    teacher.current = engine.createTeacher(pack, pack.steps, 'guided')
    startedAt.current = performance.now()
    setStrokes([])
    setGhosts(teacher.current.state().ghosts)
    setRecording({ events: [] })
  }

  return (
    <section className="screen" aria-labelledby="demo-title">
      <header className="screen-intro">
        <h1 id="demo-title">Canvas test</h1>
        <p className="screen-lead">Draw on the fox. Ghosts update after every stroke; the replay below plays your strokes at 4×.</p>
      </header>
      <div className="demo-layout">
        <div className="canvas-column">
          <div className="canvas-stack">
            <DrawingCanvas strokes={strokes} onStroke={handleStroke} penSize={penSize} />
            <GhostLayer ghosts={ghosts} />
          </div>
          <CanvasToolbar
            penSize={penSize}
            onPenSize={setPenSize}
            onUndo={() => setStrokes((s) => s.slice(0, -1))}
            onClear={clear}
            canUndo={strokes.length > 0}
          />
          <ExportStrokesButton strokes={strokes} fileName={`${pack.subject}-canvas-demo`} />
        </div>
        <div className="canvas-column">
          <h2>Replay</h2>
          <ReplayPlayer recording={recording} initialGhosts={startGhosts} />
        </div>
      </div>
    </section>
  )
}
