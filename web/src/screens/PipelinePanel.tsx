// Placeholder for "How this lesson was made": the pack's pipeline stages in a modal.
// Jeff's J4 turns it into the illustrated strip of stages.
import { useEffect, useRef, type SyntheticEvent } from 'react'
import type { Pack } from '../engine/types'
import { resolveAsset } from '../lib/packs'

interface PipelinePanelProps {
  pack: Pack
  open: boolean
  onClose: () => void
}

export default function PipelinePanel({ pack, open, onClose }: PipelinePanelProps) {
  // A native <dialog> gives us a focus trap, Escape to close and a backdrop for free.
  // It stays mounted and is opened or closed to match `open`. (Opening it on mount and closing it in an effect
  // cleanup breaks in React StrictMode: the cleanup's close event arrives after the remount and shuts the panel.)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
  }, [open])

  // Escape fires a "cancel" event. Instead of letting the browser close the dialog by itself, we tell the parent,
  // which sets `open` to false and the effect above closes it. That keeps `open` and the dialog in sync even in
  // browsers that skip the "close" event after Escape (seen in testing: the panel then refused to reopen).
  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault()
    onClose()
  }

  return (
    <dialog ref={dialog} className="pipeline-panel" aria-labelledby="pipeline-title" onCancel={handleCancel} onClose={onClose}>
      <header className="pipeline-header">
        <h2 id="pipeline-title">How this lesson was made</h2>
        <button type="button" className="btn btn-quiet" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <p className="screen-lead">Every lesson goes through these stages before you see it.</p>
      <ol className="pipeline-stages">
        {pack.pipeline.map((stage) => {
          const images = stage.images ?? (stage.image ? [stage.image] : [])
          return (
            <li key={stage.id}>
              <h3>{stage.label}</h3>
              {stage.text && <p>{stage.text}</p>}
              {images.length > 0 && (
                <div className="pipeline-images">
                  {images.map((path, i) => (
                    <img key={path} src={resolveAsset(pack, path)} alt={`${stage.label}, image ${i + 1}`} />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </dialog>
  )
}
