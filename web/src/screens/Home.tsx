// The home page: what Ghost Lines is for, how a lesson works, and how image AI makes each lesson, before the
// drawing itself starts. Everything shown is real: the hero fox is drawn from the fox lesson's own plan strokes,
// in the order the lesson teaches them, and the pipeline images are the ones that made that lesson.
// Motion: the fox draws itself once (Replay draws it again) and sections fade in as they scroll into view.
// With prefers-reduced-motion everything is shown in its final state straight away.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Pack, PlanStroke, Point } from '../engine/types'
import { loadPack, resolveAsset } from '../lib/packs'
import '../styles/home.css'

const HERO_PACK = 'fox-medium'
const OWN_PACK = 'sneaker-medium' // the "type a subject" demo
const OWN_PROMPT = 'a sneaker'
const TYPE_START = 0.5 // seconds after the demo scrolls into view before typing starts...
const TYPE_STEP = 0.12 // ...and between letters
const DRAW_SECONDS = 4.2 // how long the hero fox takes to draw itself

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A plan stroke as an SVG path, with each point joined to the midpoint of the next for smooth curves.
function pathOf(points: Point[]): string {
  if (points.length < 2) return ''
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  const [lx, ly] = points[points.length - 1]
  return `${d} L${lx} ${ly}`
}

// Adds "is-visible" to the element the first time it scrolls into view (CSS does the animating).
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      node.classList.add('is-visible')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.classList.add('is-visible')
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return ref
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}

// ---------- icons (inline SVG, 24 x 24, drawn with the current text color) ----------

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="home-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const PencilIcon = () => <Icon><path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z" /><path d="M14 6l3 3" /></Icon>
const GhostLineIcon = () => <Icon><path d="M3 17c3-6 6-9 9-9s6 3 9 9" strokeDasharray="2.5 3" /><circle cx="12" cy="8" r="1.6" /></Icon>
const ReportIcon = () => <Icon><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>
const ArrowIcon = () => <Icon><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
const ReplayIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></Icon>
const CheckIcon = () => <Icon><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>

// ---------- drawings made from a pack's own strokes ----------

// The ink of a drawing, one stroke at a time in lesson order: stroke i starts at `start + i * step` seconds.
// Each path has pathLength 1, so CSS can draw any stroke with stroke-dashoffset going from 1 to 0.
function Ink({ strokes, start, seconds }: { strokes: PlanStroke[]; start: number; seconds: number }) {
  const step = strokes.length > 0 ? seconds / strokes.length : 0
  return (
    <g className="sketch-ink">
      {strokes.map((s, i) => (
        <path key={s.id} d={pathOf(s.points)} pathLength={1}
          style={{ '--draw-delay': `${start + i * step}s`, '--draw-time': `${Math.max(0.25, step * 2.2)}s` } as CSSProperties} />
      ))}
    </g>
  )
}

const inkStrokes = (pack: Pack | null) => (pack ? pack.strokes.filter((s) => s.tier !== 'construction') : [])

function HeroDrawing({ pack }: { pack: Pack | null }) {
  const [run, setRun] = useState(0) // bumping this remounts the sheet, which replays the drawing and the chips
  const strokes = inkStrokes(pack)
  const start = 0.9 // the ghost lines show on their own for a moment first

  return (
    <figure className="hero-sketch" aria-label="A fox drawing itself, line by line, over faint blue ghost lines">
      <div key={run} className="hero-paper">
        {pack ? (
          <svg className="sketch-svg" viewBox="0 0 768 768" aria-hidden="true">
            {/* The ghost lines come first: the construction shapes, then every stroke, faint and dashed. */}
            <g className="sketch-ghosts">
              {pack.strokes.map((s) => <path key={s.id} d={pathOf(s.points)} />)}
            </g>
            <Ink strokes={strokes} start={start} seconds={DRAW_SECONDS} />
          </svg>
        ) : (
          <div className="sketch-svg sketch-loading" aria-hidden="true" />
        )}
        <span className="hero-chip hero-chip-ghost" aria-hidden="true"><GhostLineIcon /> Ghost lines guide each stroke</span>
        <span className="hero-chip hero-chip-done" aria-hidden="true"
          style={{ '--chip-delay': `${start + DRAW_SECONDS + 0.3}s` } as CSSProperties}>
          <CheckIcon /> Lesson complete
        </span>
      </div>
      {pack && (
        <button type="button" className="hero-replay" onClick={() => setRun((r) => r + 1)}>
          <ReplayIcon /> Replay
        </button>
      )}
    </figure>
  )
}

// ---------- the page ----------

export default function Home({ onStart }: { onStart: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null)
  const [ownPack, setOwnPack] = useState<Pack | null>(null)
  useEffect(() => {
    let alive = true
    // If a pack fails to load the page still works, with text in place of the drawing.
    loadPack(HERO_PACK).then((p) => alive && setPack(p), () => {})
    loadPack(OWN_PACK).then((p) => alive && setOwnPack(p), () => {})
    return () => {
      alive = false
    }
  }, [])

  const stage = (id: string) => pack?.pipeline.find((s) => s.id === id)
  const chosen = stage('chosen')?.image
  const asset = (path: string | undefined) => (pack && path ? resolveAsset(pack, path) : undefined)
  const subject = pack?.source.prompt ?? 'a fox'

  return (
    <div className="home">
      {/* ---------- hero ---------- */}
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="home-eyebrow">An AI drawing teacher</p>
          <h1 className="home-title">
            <span className="home-title-line">Draw it yourself.</span>{' '}
            <span className="home-title-accent">
              Then watch it get{' '}
              <span className="home-underlined">
                better.
                {/* A hand-drawn underline that draws itself under the promise. */}
                <svg className="home-underline" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M3 9c40-5 80-7 120-5s90 4 120 1 40-3 54-2" pathLength={1} />
                </svg>
              </span>
            </span>
          </h1>
          <p className="home-lede">
            Ghost Lines tests your drawing, teaches your weak spots with faint guide lines that follow your hand,
            then tests you again and shows exactly what improved.
          </p>
          <div className="home-actions">
            <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
              Start drawing <ArrowIcon />
            </button>
            <a className="btn btn-quiet btn-large" href="#how">See how it works</a>
          </div>
          <p className="home-note">Free · runs in your browser · works with a mouse, pen or finger</p>
        </div>
        <HeroDrawing pack={pack} />
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="home-section">
        <Reveal className="home-section-head">
          <p className="home-eyebrow">How it works</p>
          <h2>Three steps, and proof you improved</h2>
        </Reveal>
        <ol className="home-steps">
          {[
            { icon: <PencilIcon />, title: 'Test', text: 'Copy a drawing on your own. Ghost Lines measures every part: its size, its position and its shape.' },
            { icon: <GhostLineIcon />, title: 'Learn', text: 'Faint ghost lines guide each stroke. They bend to follow your hand and fade away as you get better.' },
            { icon: <ReportIcon />, title: 'Retest', text: 'Draw it again, alone. A side-by-side report card shows what you fixed, measured from your strokes.' },
          ].map((s, i) => (
            <li key={s.title}>
              <Reveal className="home-step" delay={i * 110}>
                <span className="home-step-icon">{s.icon}</span>
                <span className="home-step-number" aria-hidden="true">0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- how image AI makes a lesson ---------- */}
      <section className="home-section home-ai">
        <Reveal className="home-section-head">
          <p className="home-eyebrow">Image AI, start to finish</p>
          <h2>Every lesson is made by image AI</h2>
          <p className="home-section-lede">
            This is how the fox lesson was made. SDXL-Lightning draws the subject, the drawing is traced into strokes,
            OWLv2 finds its parts, and the strokes are put in the order an artist would draw them.
          </p>
        </Reveal>
        <ol className="home-pipeline">
          <li>
            <Reveal className="pipe-card" delay={0}>
              <div className="pipe-art pipe-prompt">
                <span className="pipe-prompt-label">Prompt</span>
                <span className="pipe-prompt-text">{subject}</span>
                {/* The start and end of the style prompt the lessons were built with (server/pipeline/prompts.py). */}
                <span className="pipe-prompt-style">
                  minimalist line icon of <strong>{subject}</strong>, full body, bold uniform black outline only, flat,
                  very few lines, … isolated on plain white background
                </span>
              </div>
              <h3>1. A prompt</h3>
              <p>The subject is wrapped in a line-art style, so the drawing comes out clean and simple.</p>
            </Reveal>
          </li>
          <li>
            <Reveal className="pipe-card" delay={100}>
              <div className="pipe-art pipe-drafts">
                {(stage('candidates')?.images ?? []).map((src, i) => (
                  <span key={src} className={`pipe-draft${src === chosen ? ' is-chosen' : ''}`}>
                    <img src={asset(src)} alt={`AI draft ${i + 1}${src === chosen ? ', the one chosen' : ''}`} loading="lazy" />
                    {src === chosen && <span className="pipe-draft-tag">Chosen</span>}
                  </span>
                ))}
              </div>
              <h3>2. Four AI drafts</h3>
              <p>SDXL-Lightning draws four versions. The cleanest one is chosen.</p>
            </Reveal>
          </li>
          <li>
            <Reveal className="pipe-card" delay={200}>
              <div className="pipe-art">
                {asset(stage('skeleton')?.image) && <img src={asset(stage('skeleton')?.image)} alt="The chosen draft thinned to one-pixel lines" loading="lazy" />}
              </div>
              <h3>3. Traced into strokes</h3>
              <p>The lines are thinned to one pixel and traced into the strokes you will draw.</p>
            </Reveal>
          </li>
          <li>
            <Reveal className="pipe-card" delay={300}>
              <div className="pipe-art">
                {asset(stage('parts')?.image) && <img src={asset(stage('parts')?.image)} alt="The fox with a box around each part OWLv2 found" loading="lazy" />}
              </div>
              <h3>4. Parts found</h3>
              <p>OWLv2 finds the head, ears, legs and tail, so your weak spots have names.</p>
            </Reveal>
          </li>
        </ol>
      </section>

      {/* ---------- make your own ---------- */}
      <section className="home-section home-own">
        <Reveal className="home-own-text">
          <p className="home-eyebrow">Draw anything</p>
          <h2>Type a subject, or upload a photo</h2>
          <p className="home-section-lede">
            When our GPU server is online, image AI builds a brand-new lesson from whatever you type or photograph,
            in under a minute. Ready-made subjects always work, online or not.
          </p>
          <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
            Pick something to draw <ArrowIcon />
          </button>
        </Reveal>
        <Reveal className="home-own-demo" delay={150}>
          <div className="own-input" aria-hidden="true">
            <span className="own-typed">
              {/* Each letter appears in turn, as if typed. */}
              {[...OWN_PROMPT].map((ch, i) => (
                <span key={i} style={{ '--type-delay': `${TYPE_START + i * TYPE_STEP}s` } as CSSProperties}>{ch === ' ' ? '\u00a0' : ch}</span>
              ))}
            </span>
            <span className="own-caret" />
          </div>
          <div className="own-arrow" aria-hidden="true"><ArrowIcon /></div>
          <figure className="own-result" aria-label={`The ${OWN_PROMPT.slice(2)} lesson, made by image AI from the prompt “${OWN_PROMPT}”`}>
            {ownPack && (
              <svg className="sketch-svg" viewBox="0 0 768 768" aria-hidden="true">
                <Ink strokes={inkStrokes(ownPack)} start={TYPE_START + OWN_PROMPT.length * TYPE_STEP + 0.4} seconds={2.4} />
              </svg>
            )}
          </figure>
        </Reveal>
      </section>

      {/* ---------- final call to action ---------- */}
      <section className="home-final">
        <Reveal className="home-final-inner">
          <h2>Ready when you are</h2>
          <p>Pick a subject, draw it once on your own, and see where your lesson starts.</p>
          <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
            Start drawing <ArrowIcon />
          </button>
        </Reveal>
      </section>

      <footer className="home-footer">
        <span>Ghost Lines · built at Banana Hacks 2026</span>
        <span className="home-footer-links">
          <a href="https://github.com/aarushgupta850/Bananahacks-">Source on GitHub</a>
          <a href="https://github.com/aarushgupta850/Bananahacks-/blob/main/CREDITS.md">Credits</a>
        </span>
      </footer>
    </div>
  )
}
