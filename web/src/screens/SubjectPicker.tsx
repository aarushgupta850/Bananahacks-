// Screen 1: choose what to draw. Ready-made subjects come from subjects/index.json; each card has a difficulty
// picker showing only the difficulties that subject has. "Make your own" asks the optional live generation
// server for a new pack from a text prompt or a photo. When the server is offline the inputs are disabled with
// a friendly note: the app never shows an error, it always offers a way forward.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Difficulty, Pack, SubjectIndex } from '../engine/types'
import { checkLive, generate, LiveError, PHOTO_UNREADABLE, preparePhoto, type GenerateRequest, type LiveErrorKind } from '../lib/live'
import { loadIndex, loadPack, resolveIndexAsset } from '../lib/packs'
import { emptySession, useSession } from '../session'
import PlaceholderScreen from './PlaceholderScreen'
import ProgressPanel from './ProgressPanel'
import SketchLoader from './SketchLoader'
import { liveWaitText, useSecondsSince } from './liveWait'

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

const PHOTO_REJECTED = "We couldn't turn that photo into a clean drawing. Try one object on a plain background, or type what it is."

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

  // A new pack (ready-made or live) starts a fresh session, keeping the chosen time limit. A live pack also keeps
  // the request that made it, so the Reference screen can ask for a new drawing of the same thing.
  function start(pack: Pack, liveRequest: GenerateRequest | null = null) {
    update({ ...emptySession, pack, soloSeconds: session.soloSeconds, liveRequest })
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
      {/* Only shows once a session has been finished in this browser. */}
      <ProgressPanel />

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
                    {/* The chosen difficulty's own picture, so switching Simple/Medium visibly changes the drawing. */}
                    <img key={chosen} src={resolveIndexAsset(chosen && subject.packs[chosen] ? `${subject.packs[chosen]}/thumb.png` : subject.thumb)}
                      alt="" width={256} height={256} loading="lazy" />
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
  | { kind: 'generating'; waiting?: boolean } // waiting: someone else's lesson is being drawn first
  | { kind: 'problem'; message: string }

// A chosen photo, already turned into a small JPEG (base64, no data: prefix) when it was picked.
type ChosenPhoto = { name: string; base64: string }

function MakeYourOwn({ onPack }: { onPack: (pack: Pack, request: GenerateRequest) => void }) {
  const [live, setLive] = useState<LiveState>({ kind: 'checking' })
  const [prompt, setPrompt] = useState('')
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null)
  const [preparing, setPreparing] = useState(false) // the chosen photo is being opened and shrunk
  const [photoProblem, setPhotoProblem] = useState<string | null>(null) // why the last chosen file can't be used
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')

  // Opens the chosen file right away, so a file the browser can't open is caught now (with what to do instead),
  // and the user sees which photo will be sent.
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // so choosing the same file again (after Remove) still counts as a change
    if (!file) return
    setPreparing(true)
    setPhotoProblem(null)
    try {
      setPhoto({ name: file.name, base64: await preparePhoto(file) })
    } catch (error) {
      console.error(error)
      setPhoto(null)
      setPhotoProblem(error instanceof LiveError && error.userMessage ? error.userMessage : PHOTO_UNREADABLE)
    } finally {
      setPreparing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    checkLive().then((ok) => { if (!cancelled) setLive({ kind: ok ? 'online' : 'offline' }) })
    return () => { cancelled = true }
  }, [])

  // While it says offline, look again every 15 s, so a slow first check (or a server that comes back) doesn't
  // leave the box saying "offline" until the page is reloaded.
  const offline = live.kind === 'offline'
  useEffect(() => {
    if (!offline) return
    let cancelled = false
    const timer = window.setInterval(() => {
      checkLive().then((ok) => { if (ok && !cancelled) setLive({ kind: 'online' }) })
    }, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [offline])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if ((!prompt.trim() && !photo) || preparing) return
    setLive({ kind: 'generating' })
    try {
      const request: GenerateRequest = {
        prompt: prompt.trim() || undefined,
        imageBase64: photo?.base64,
        difficulty,
      }
      const pack = await generate(request, () => setLive({ kind: 'generating', waiting: true }))
      onPack(pack, request)
    } catch (error) {
      console.error(error)
      const kind: LiveErrorKind = error instanceof LiveError ? error.kind : 'failed'
      // The server's own reason, when it gave one, says best what to change ("Couldn't tell what's in that
      // photo..."). Otherwise a refused photo is usually a busy one (a background, several objects): say what helps.
      const reason = error instanceof LiveError ? error.userMessage : undefined
      const message = reason ?? (photo && kind === 'rejected' ? PHOTO_REJECTED : LIVE_MESSAGES[kind])
      setLive(kind === 'offline' ? { kind: 'offline' } : { kind: 'problem', message })
    }
  }

  const enabled = live.kind === 'online' || live.kind === 'problem'
  const waited = useSecondsSince(live.kind === 'generating')

  return (
    <section className="make-own" aria-labelledby="make-own-title">
      <header className="make-own-header">
        <h2 id="make-own-title">Make your own</h2>
        {enabled && <span className="live-badge"><span className="live-dot" aria-hidden="true" />Live AI</span>}
      </header>
      <p className="muted">Type anything, or upload a photo. Image AI draws it, traces it and turns it into a lesson.</p>

      {live.kind === 'generating' ? (
        <SketchLoader text={liveWaitText(waited, live.waiting === true)} />
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
          {/* The real file input is hidden; its label is drawn as a button. A chosen photo shows as a small preview
              with its name and a Remove button, so it is clear what will be sent (and a prompt alone can be sent again). */}
          <div className="field">
            <span>or a photo</span>
            <div className="photo-row">
              <label className={enabled && !preparing ? 'btn photo-pick' : 'btn photo-pick is-disabled'}>
                <input
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  disabled={!enabled || preparing}
                  onChange={choosePhoto}
                />
                {preparing ? 'Opening photo…' : photo ? 'Change photo' : 'Choose a photo'}
              </label>
              {photo && (
                <>
                  <img className="photo-preview" src={`data:image/jpeg;base64,${photo.base64}`} alt={`Your photo: ${photo.name}`} />
                  <span className="photo-name" title={photo.name}>{photo.name}</span>
                  <button type="button" className="btn photo-remove" onClick={() => setPhoto(null)} aria-label={`Remove photo ${photo.name}`}>
                    Remove
                  </button>
                </>
              )}
            </div>
            {photoProblem && <p className="notice" role="status">{photoProblem}</p>}
          </div>
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
          <button type="submit" className="btn btn-primary" disabled={!enabled || preparing || (!prompt.trim() && !photo)}>
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
