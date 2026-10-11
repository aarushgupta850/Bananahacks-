// Undo, clear and the three pen sizes, shown under a DrawingCanvas.
// It only reports what was pressed; the parent changes its own list of strokes.
import { PEN_SIZES, type PenSize } from './geometry'
import './canvas.css'

interface CanvasToolbarProps {
  penSize: PenSize
  onPenSize: (size: PenSize) => void
  onUndo: () => void
  onClear: () => void
  canUndo: boolean // false when there is nothing to undo or clear
}

const SIZE_NAMES: Record<PenSize, string> = { fine: 'Fine pen', medium: 'Medium pen', bold: 'Bold pen' }

export default function CanvasToolbar({ penSize, onPenSize, onUndo, onClear, canUndo }: CanvasToolbarProps) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="pen-sizes" role="radiogroup" aria-label="Pen size">
        {(Object.keys(PEN_SIZES) as PenSize[]).map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={penSize === size}
            aria-label={SIZE_NAMES[size]}
            title={SIZE_NAMES[size]}
            className={penSize === size ? 'tool-btn is-active' : 'tool-btn'}
            onClick={() => onPenSize(size)}
          >
            {/* A dot as wide as the pen, so the size is visible and not only named. */}
            <span className="pen-dot" style={{ width: PEN_SIZES[size] * 1.4, height: PEN_SIZES[size] * 1.4 }} />
          </button>
        ))}
      </div>
      <div className="canvas-actions">
        <button type="button" className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo last stroke" title="Undo">
          ↶ <span className="tool-text">Undo</span>
        </button>
        <button type="button" className="tool-btn" onClick={onClear} disabled={!canUndo} aria-label="Clear drawing" title="Clear">
          ✕ <span className="tool-text">Clear</span>
        </button>
      </div>
    </div>
  )
}
