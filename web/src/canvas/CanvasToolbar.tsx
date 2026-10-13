// The drawing tools shown under a DrawingCanvas: three pen sizes and the eraser (one radio group: picking a
// pen size switches back from the eraser to the pen), then Undo and Clear.
// It only reports what was pressed; the parent changes its own list of strokes.
import { useEffect } from 'react'
import type { Tool } from './DrawingCanvas'
import { PEN_SIZES, type PenSize } from './geometry'
import './canvas.css'

interface CanvasToolbarProps {
  penSize: PenSize
  onPenSize: (size: PenSize) => void
  tool?: Tool                       // leave out onTool to hide the eraser
  onTool?: (tool: Tool) => void
  onUndo: () => void
  onClear: () => void
  canUndo: boolean                  // false when there is nothing to undo
  canClear?: boolean                // false when the canvas is empty (defaults to canUndo)
}

const SIZE_NAMES: Record<PenSize, string> = { fine: 'Fine pen', medium: 'Medium pen', bold: 'Bold pen' }

export default function CanvasToolbar({
  penSize, onPenSize, tool = 'pen', onTool, onUndo, onClear, canUndo, canClear = canUndo,
}: CanvasToolbarProps) {
  // Ctrl+Z (Cmd+Z on a Mac) undoes the last stroke, like in every drawing app. Typing in a text box is left alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || typing || !canUndo) return
      event.preventDefault()
      onUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, canUndo])

  const erasing = onTool !== undefined && tool === 'eraser'

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="pen-sizes" role="radiogroup" aria-label="Pen size or eraser">
        {(Object.keys(PEN_SIZES) as PenSize[]).map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={!erasing && penSize === size}
            aria-label={SIZE_NAMES[size]}
            title={SIZE_NAMES[size]}
            className={!erasing && penSize === size ? 'tool-btn is-active' : 'tool-btn'}
            onClick={() => {
              onPenSize(size)
              onTool?.('pen')
            }}
          >
            {/* A dot as wide as the pen, so the size is visible and not only named. */}
            <span className="pen-dot" style={{ width: PEN_SIZES[size] * 1.4, height: PEN_SIZES[size] * 1.4 }} />
          </button>
        ))}
        {onTool && (
          <button
            type="button"
            role="radio"
            aria-checked={erasing}
            aria-label="Eraser"
            title="Eraser: drag over lines to rub out parts of them"
            className={erasing ? 'tool-btn is-active' : 'tool-btn'}
            onClick={() => onTool('eraser')}
          >
            {/* A simple tilted eraser block. */}
            <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
              <path d="M8.5 20 3.6 15.1a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l4.9 4.9a2 2 0 0 1 0 2.8L11.3 20Z" />
              <path d="M8.5 20H20M7 10.9l6.1 6.1" />
            </svg>
            <span className="tool-text">Eraser</span>
          </button>
        )}
      </div>
      <div className="canvas-actions">
        <button type="button" className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          ↶ <span className="tool-text">Undo</span>
        </button>
        <button type="button" className="tool-btn" onClick={onClear} disabled={!canClear} aria-label="Clear drawing" title="Clear">
          ✕ <span className="tool-text">Clear</span>
        </button>
      </div>
    </div>
  )
}
