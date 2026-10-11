// Placeholder: the list of ready-made subjects from subjects/index.json. Picking one loads its pack.
// Jeff's J2a adds difficulty levels, "Make your own" and live generation.
import { useEffect, useState } from 'react'
import type { SubjectIndex } from '../engine/types'
import { loadIndex, loadPack, resolveIndexAsset } from '../lib/packs'
import { emptySession, useSession } from '../session'
import PlaceholderScreen from './PlaceholderScreen'

type Subject = SubjectIndex['subjects'][number]

type IndexState =
  | { kind: 'loading' }
  | { kind: 'ready'; subjects: Subject[] }
  | { kind: 'failed' }

// Medium is the default difficulty; otherwise take whichever one the subject has.
function defaultPackId(subject: Subject): string | undefined {
  return subject.packs.medium ?? subject.packs.simple ?? subject.packs.detailed
}

export default function SubjectPicker({ onNext }: { onNext: () => void }) {
  const { update } = useSession()
  const [index, setIndex] = useState<IndexState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0) // bumped by "Try again" to reload the index
  const [opening, setOpening] = useState<string | null>(null) // the subject whose pack is loading
  const [packFailed, setPackFailed] = useState(false)

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

  async function choose(subject: Subject) {
    const packId = defaultPackId(subject)
    if (!packId) return
    setOpening(subject.subject)
    setPackFailed(false)
    try {
      const pack = await loadPack(packId)
      update({ ...emptySession, pack }) // a new subject starts a fresh session
      onNext()
    } catch (error) {
      console.error(error)
      setPackFailed(true)
      setOpening(null)
    }
  }

  return (
    <PlaceholderScreen title="Choose a subject" lead="Pick something to draw. We'll test you, teach you, then retest you.">
      {index.kind === 'loading' && <p role="status">Loading subjects…</p>}

      {index.kind === 'failed' && (
        <div className="notice" role="alert">
          <p>We couldn't load the subjects. Check your connection and try again.</p>
          <button type="button" className="btn" onClick={retry}>Try again</button>
        </div>
      )}

      {index.kind === 'ready' && (
        <ul className="subject-grid">
          {index.subjects.map((subject) => (
            <li key={subject.subject}>
              <button
                type="button"
                className="subject-card"
                onClick={() => choose(subject)}
                disabled={opening !== null || !defaultPackId(subject)}
                aria-busy={opening === subject.subject}
              >
                {/* Decorative: the button is already named by the title below it. */}
                <img src={resolveIndexAsset(subject.thumb)} alt="" width={256} height={256} />
                <span className="subject-title">{subject.title}</span>
                {opening === subject.subject && <span className="subject-status">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {packFailed && (
        <p className="notice" role="alert">That lesson didn't load. Please try again, or pick another subject.</p>
      )}
    </PlaceholderScreen>
  )
}
