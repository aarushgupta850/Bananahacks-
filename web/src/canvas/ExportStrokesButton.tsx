// Developer tool, shown only when the URL has ?dev=1: downloads the drawn strokes as JSON.
// Aarush uses these files as real drawings to test and tune the engine.
import type { UserStroke } from '../engine/types'
import { isDevMode } from './devMode'

export default function ExportStrokesButton({ strokes, fileName }: { strokes: UserStroke[]; fileName: string }) {
  if (!isDevMode()) return null

  function download() {
    const blob = new Blob([JSON.stringify({ strokes }, null, 0)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button type="button" className="btn btn-quiet dev-only" onClick={download} disabled={strokes.length === 0}>
      Export strokes (dev)
    </button>
  )
}
