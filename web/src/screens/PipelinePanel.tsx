// "How this lesson was made": the image-AI pipeline behind the current lesson, as a strip of stages the user
// steps through: prompt (or photo) -> 4 AI drafts (the chosen one marked) -> the chosen drawing -> traced lines
// -> parts found -> the lesson order, which animates live. Every image and caption comes from pack.pipeline,
// written by the pack builder; stages without images (like the hand-made demo fox) show their text only.
import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { Pack, PipelineStage } from '../engine/types'
import { resolveAsset } from '../lib/packs'
import LessonAnimation from './LessonAnimation'
import { TIER_NAMES, TIER_ORDER } from './lessonOrder'

interface PipelinePanelProps {
  pack: Pack
  open: boolean
  onClose: () => void
}

// A plain-English headline for each stage. The pack's own text (with its real numbers) goes underneath.
function headline(stage: PipelineStage, pack: Pack): string {
  switch (stage.id) {
    case 'source': return pack.source.kind === 'photo' ? 'It starts with your photo' : 'It starts with a prompt'
    case 'candidates': return 'Image AI draws four line-art drafts'
    case 'chosen': return 'The cleanest draft becomes your drawing'
    case 'skeleton': return 'Lines are thinned to 1 px and traced into strokes'
    case 'parts': return 'AI finds and labels the parts'
    case 'order': return 'Ordered the way an artist draws'
  }
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

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
    close()
  }

  const stages = pack.pipeline
  const [active, setActive] = useState(0)
  const [run, setRun] = useState(0) // bumped to replay the lesson animation
  const cards = useRef<(HTMLLIElement | null)[]>([])
  const chosenPath = stages.find((s) => s.id === 'chosen')?.image

  const strip = useRef<HTMLOListElement>(null)

  // Closing resets the panel, so the next time it opens it starts again at the first stage.
  function close() {
    setActive(0)
    if (strip.current) strip.current.scrollLeft = 0
    onClose()
  }

  function goTo(index: number) {
    const next = Math.min(stages.length - 1, Math.max(0, index))
    setActive(next)
    cards.current[next]?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
    // Arriving at the lesson stage plays the animation from the start.
    if (stages[next]?.id === 'order') setRun((r) => r + 1)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      goTo(active + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goTo(active - 1)
    }
  }

  return (
    <dialog ref={dialog} className="pipeline-panel" aria-labelledby="pipeline-title"
      onCancel={handleCancel} onClose={close} onKeyDown={handleKeyDown}>
      <header className="pipeline-header">
        <div>
          <h2 id="pipeline-title">How this lesson was made</h2>
          <p className="pipeline-intro">
            Every lesson is created by image AI: generated, traced, labeled and ordered the way an artist would draw it.
          </p>
        </div>
        <button type="button" className="tool-btn" aria-label="Close" onClick={close}>✕</button>
      </header>

      <ol ref={strip} className="pipeline-strip" aria-label="Pipeline stages">
        {stages.map((stage, i) => {
          const images = stage.images ?? (stage.image ? [stage.image] : [])
          return (
            <li
              key={stage.id}
              ref={(el) => { cards.current[i] = el }}
              className={i === active ? 'pipeline-stage is-active' : 'pipeline-stage'}
              aria-current={i === active ? 'step' : undefined}
              onClick={() => i !== active && goTo(i)}
            >
              <span className="stage-number">Stage {i + 1} · {stage.label}</span>
              <h3>{headline(stage, pack)}</h3>

              {stage.id === 'source' && pack.source.kind === 'prompt' && pack.source.prompt && (
                <blockquote className="stage-prompt">“{pack.source.prompt}”</blockquote>
              )}

              {stage.id === 'order' ? (
                <div className="stage-visual">
                  <LessonAnimation pack={pack} run={run} />
                </div>
              ) : images.length > 0 && (
                <div className={images.length > 1 ? 'stage-visual stage-grid' : 'stage-visual'}>
                  {images.map((path, k) => {
                    const chosen = stage.id === 'candidates' && path === chosenPath
                    return (
                      <figure key={path} className={chosen ? 'stage-image is-chosen' : 'stage-image'}>
                        <img src={resolveAsset(pack, path)} loading="lazy"
                          alt={stage.id === 'candidates' ? `AI draft ${k + 1}${chosen ? ', the one chosen' : ''}` : `${stage.label}`} />
                        {chosen && <figcaption className="chosen-badge">✓ Chosen</figcaption>}
                      </figure>
                    )
                  })}
                </div>
              )}

              {stage.text && stage.id === 'source' && stage.text !== pack.source.prompt && (
                // The pack keeps the full prompt the image model got; the subject is wrapped in a line-art style.
                <p className="stage-text"><span className="stage-text-label">Sent to the AI as: </span><code>{stage.text}</code></p>
              )}
              {stage.text && stage.id !== 'source' && <p className="stage-text">{stage.text}</p>}

              {stage.id === 'order' && (
                <>
                  <ul className="tier-legend" aria-label="Stroke colors">
                    {TIER_ORDER.map((tier) => (
                      <li key={tier}><span className={`tier-swatch tier-${tier}`} aria-hidden="true" />{TIER_NAMES[tier]}</li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-quiet" onClick={(e) => { e.stopPropagation(); setRun((r) => r + 1) }}>
                    ↻ Replay
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ol>

      <nav className="pipeline-nav" aria-label="Stage navigation">
        <button type="button" className="tool-btn" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous stage">←</button>
        <div className="pipeline-dots">
          {stages.map((stage, i) => (
            <button key={stage.id} type="button" className={i === active ? 'dot is-active' : 'dot'}
              aria-label={`Stage ${i + 1}: ${stage.label}`} aria-current={i === active ? 'step' : undefined} onClick={() => goTo(i)} />
          ))}
        </div>
        <button type="button" className="tool-btn" onClick={() => goTo(active + 1)} disabled={active === stages.length - 1} aria-label="Next stage">→</button>
      </nav>
    </dialog>
  )
}
