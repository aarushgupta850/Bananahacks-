// Undo, clear and the three pen sizes, shown under a DrawingCanvas.
// It only reports what was pressed; the parent changes its own list of strokes.
import { useEffect } from 'react'
import { PEN_SIZES, type PenSize } from './geometry'
import './canvas.css'

interface CanvasToolbarProps {
  penSize: PenSize
  onPenSize: (size: PenSize) => void
  onUndo: () => void
  onClear: () => void
  canUndo: boolean // false when there is nothing to undo or clear
  tool?: 'pen' | 'eraser'                       // with onTool: shows the eraser next to the pen sizes
  onTool?: (tool: 'pen' | 'eraser') => void
}

const SIZE_NAMES: Record<PenSize, string> = { fine: 'Fine pen', medium: 'Medium pen', bold: 'Bold pen' }

export default function CanvasToolbar({ penSize, onPenSize, onUndo, onClear, canUndo, tool = 'pen', onTool }: CanvasToolbarProps) {
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

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="pen-sizes" role="radiogroup" aria-label="Pen size or eraser">
        {(Object.keys(PEN_SIZES) as PenSize[]).map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={tool === 'pen' && penSize === size}
            aria-label={SIZE_NAMES[size]}
            title={SIZE_NAMES[size]}
            className={tool === 'pen' && penSize === size ? 'tool-btn is-active' : 'tool-btn'}
            onClick={() => { onPenSize(size); onTool?.('pen') }}
          >
            {/* A dot as wide as the pen, so the size is visible and not only named. */}
            <span className="pen-dot" style={{ width: PEN_SIZES[size] * 1.4, height: PEN_SIZES[size] * 1.4 }} />
          </button>
        ))}
        {onTool && (
          // Erases only the parts of lines it passes over; picking a pen size goes back to drawing.
          <button type="button" role="radio" aria-checked={tool === 'eraser'} aria-label="Eraser" title="Eraser: rub out part of a line"
            className={tool === 'eraser' ? 'tool-btn tool-eraser is-active' : 'tool-btn tool-eraser'} onClick={() => onTool('eraser')}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M15.5 4.5l4 4L10 18H6l-2-2 11.5-11.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 11l4 4M10 18h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="canvas-actions">
        <button type="button" className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo last stroke" title="Undo (Ctrl+Z)">
          ↶ <span className="tool-text">Undo</span>
        </button>
        <button type="button" className="tool-btn" onClick={onClear} disabled={!canUndo} aria-label="Clear drawing" title="Clear">
          ✕ <span className="tool-text">Clear</span>
        </button>
      </div>
    </div>
  )
}
