// Screen 1: choose what to draw. Ready-made subjects come from subjects/index.json; each card has a difficulty
// picker showing only the difficulties that subject has. "Make your own" asks the optional live generation
// server for a new pack from a text prompt or a photo. When the server is offline the inputs are disabled with
// a friendly note: the app never shows an error, it always offers a way forward.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Difficulty, Pack, SubjectIndex } from '../engine/types'
import { checkLive, generate, LiveError, type LiveErrorKind } from '../lib/live'
import { loadIndex, loadPack, resolveIndexAsset } from '../lib/packs'
import { emptySession, useSession } from '../session'
import PlaceholderScreen from './PlaceholderScreen'
import SketchLoader from './SketchLoader'

type Subject = SubjectIndex['subjects'][number]

type IndexState =
  | { kind: 'loading' }
  | { kind: 'ready'; subjects: Subject[] }
  | { kind: 'failed' }

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'medium', label: 'Medium' },
  { id: 'detailed', label: 'Detailed' },
]

// Medium is the default difficulty; otherwise take whichever one the subject has.
function defaultDifficulty(subject: Subject): Difficulty | undefined {
  return (['medium', 'simple', 'detailed'] as const).find((d) => subject.packs[d])
}

// Demo packs (hand-made placeholders) are marked "(demo)" in their title or "demo-" in their folder name.
function isDemo(subject: Subject): boolean {
  return subject.title.includes('(demo)') || Object.values(subject.packs).some((id) => id?.startsWith('demo-'))
}

// Friendly words for each way live generation can fail. Every one points back to the ready-made subjects.
const LIVE_MESSAGES: Record<LiveErrorKind, string> = {
  offline: 'Live generation is offline right now. Pick a ready-made subject above!',
  timeout: 'That took too long to draw. Try again in a moment, or pick a ready-made subject above.',
  busy: 'The AI is busy drawing for someone else. Try again in a moment, or pick a ready-made subject above.',
  rejected: "We can't draw that one. Try another subject, like \"a teapot\" or \"a cat\".",
  failed: "Something went wrong making that lesson. Try again, or pick a ready-made subject above.",
}

export default function SubjectPicker({ onNext }: { onNext: () => void }) {
  const { session, update } = useSession()
  const [index, setIndex] = useState<IndexState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0) // bumped by "Try again" to reload the index
  const [opening, setOpening] = useState<string | null>(null) // the subject whose pack is loading
  const [packFailed, setPackFailed] = useState(false)
  // The difficulty picked on each card, by subject. Cards without an entry use defaultDifficulty.
  const [picked, setPicked] = useState<Record<string, Difficulty>>({})

  useEffect(() => {
    let cancelled = false // ignore the answer if the screen closed (or retried) before it arrived
    loadIndex().then(
      (loaded) => { if (!cancelled) setIndex({ kind: 'ready', subjects: loaded.subjects }) },
      (error: unknown) => {
        console.error(error) // the details are for developers; users get a friendly message
        if (!cancelled) setIndex({ kind: 'failed' })
      },
    )
    return () => { cancelled = true }
  }, [attempt])

  function retry() {
    setIndex({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  // A new pack (ready-made or live) starts a fresh session, keeping the chosen time limit.
  function start(pack: Pack) {
    update({ ...emptySession, pack, soloSeconds: session.soloSeconds })
    onNext()
  }

  async function choose(subject: Subject) {
    const difficulty = picked[subject.subject] ?? defaultDifficulty(subject)
    const packId = difficulty && subject.packs[difficulty]
    if (!packId) return
    setOpening(subject.subject)
    setPackFailed(false)
    try {
      start(await loadPack(packId))
    } catch (error) {
      console.error(error)
      setPackFailed(true)
      setOpening(null)
    }
  }

  return (
    <PlaceholderScreen title="What do you want to draw?" lead="Pick a subject. We'll test you, teach you with ghost lines, then retest you and measure what improved.">
      {index.kind === 'loading' && <p role="status" className="muted">Loading subjects…</p>}

      {index.kind === 'failed' && (
        <div className="notice" role="alert">
          <p>We couldn't load the subjects. Check your connection and try again.</p>
          <button type="button" className="btn" onClick={retry}>Try again</button>
        </div>
      )}

      {index.kind === 'ready' && (
        <ul className="subject-grid">
          {index.subjects.map((subject) => {
            const chosen = picked[subject.subject] ?? defaultDifficulty(subject)
            const available = DIFFICULTIES.filter((d) => subject.packs[d.id])
            return (
              <li key={subject.subject} className="subject-card">
                <button
                  type="button"
                  className="subject-open"
                  onClick={() => choose(subject)}
                  disabled={opening !== null || !chosen}
                  aria-busy={opening === subject.subject}
                  aria-label={`Draw ${subject.title}${chosen ? `, ${chosen}` : ''}`}
                >
                  <span className="subject-thumb">
                    {/* Decorative: the button is named by its aria-label. */}
                    <img src={resolveIndexAsset(subject.thumb)} alt="" width={256} height={256} loading="lazy" />
                    {/* The hand-made demo fox isn't AI-generated, so it doesn't get the badge (honesty for judges). */}
                    {!isDemo(subject) && <span className="ai-badge">AI-generated</span>}
                  </span>
                  <span className="subject-title">{subject.title}</span>
                  {opening === subject.subject && <span className="subject-status">Opening…</span>}
                </button>
                {available.length > 1 && (
                  <div className="segmented" role="radiogroup" aria-label={`${subject.title} difficulty`}>
                    {available.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={chosen === d.id}
                        className={chosen === d.id ? 'is-active' : ''}
                        onClick={() => setPicked((p) => ({ ...p, [subject.subject]: d.id }))}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                )}
                {available.length === 1 && <span className="subject-level">{available[0].label}</span>}
              </li>
            )
          })}
        </ul>
      )}

      {packFailed && (
        <p className="notice" role="alert">That lesson didn't load. Please try again, or pick another subject.</p>
      )}

      <MakeYourOwn onPack={start} />
    </PlaceholderScreen>
  )
}

// ---------- "Make your own" ----------

type LiveState =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'online' }
  | { kind: 'generating' }
  | { kind: 'problem'; message: string }

// Reads a photo as base64 without the "data:image/...;base64," prefix (what the server expects).
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function MakeYourOwn({ onPack }: { onPack: (pack: Pack) => void }) {
  const [live, setLive] = useState<LiveState>({ kind: 'checking' })
  const [prompt, setPrompt] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')

  useEffect(() => {
    let cancelled = false
    checkLive().then((ok) => { if (!cancelled) setLive({ kind: ok ? 'online' : 'offline' }) })
    return () => { cancelled = true }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim() && !photo) return
    setLive({ kind: 'generating' })
    try {
      const pack = await generate({
        prompt: prompt.trim() || undefined,
        imageBase64: photo ? await readAsBase64(photo) : undefined,
        difficulty,
      })
      onPack(pack)
    } catch (error) {
      console.error(error)
      const kind: LiveErrorKind = error instanceof LiveError ? error.kind : 'failed'
      setLive(kind === 'offline' ? { kind: 'offline' } : { kind: 'problem', message: LIVE_MESSAGES[kind] })
    }
  }

  const enabled = live.kind === 'online' || live.kind === 'problem'

  return (
    <section className="make-own" aria-labelledby="make-own-title">
      <header className="make-own-header">
        <h2 id="make-own-title">Make your own</h2>
        {enabled && <span className="live-badge"><span className="live-dot" aria-hidden="true" />Live AI</span>}
      </header>
      <p className="muted">Type anything, or upload a photo. Image AI draws it, traces it and turns it into a lesson.</p>

      {live.kind === 'generating' ? (
        <SketchLoader text="Drawing your lesson… this takes about 20 seconds." />
      ) : (
        <form className="make-own-form" onSubmit={submit}>
          <label className="field">
            <span>Subject</span>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="a teapot"
              maxLength={80}
              disabled={!enabled}
            />
          </label>
          <label className="field">
            <span>or a photo</span>
            <input
              type="file"
              accept="image/*"
              disabled={!enabled}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Difficulty for your subject">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={difficulty === d.id}
                className={difficulty === d.id ? 'is-active' : ''}
                disabled={!enabled}
                onClick={() => setDifficulty(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!enabled || (!prompt.trim() && !photo)}>
            Make my lesson
          </button>
        </form>
      )}

      {live.kind === 'checking' && <p role="status" className="muted">Checking whether live AI is available…</p>}
      {live.kind === 'offline' && <p className="notice" role="status">{LIVE_MESSAGES.offline}</p>}
      {live.kind === 'problem' && <p className="notice" role="status">{live.message}</p>}
    </section>
  )
}
