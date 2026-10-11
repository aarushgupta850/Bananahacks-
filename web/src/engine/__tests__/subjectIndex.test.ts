// Checks public/subjects/index.json against the pack folders next to it. The pipeline in /server rewrites
// index.json every time it builds a pack, so this catches a broken build before it reaches the site:
// every pack the subject picker lists must exist, match the contract, and be the difficulty it's listed under.
import { describe, expect, it } from 'vitest'
import indexText from '../../../public/subjects/index.json?raw'
import { parseIndex, parsePack } from '../../lib/packs'

const SUBJECTS = '../../../public/subjects/'
// Vite's import.meta.glob finds files when the test is compiled. Each pack.json comes in as text. For images
// only the file names are needed, so the lazy (non-eager) form is used and the images are never loaded.
const packFiles = import.meta.glob<string>('../../../public/subjects/*/pack.json', {
  query: '?raw', import: 'default', eager: true,
})
const imageFiles = new Set(Object.keys(import.meta.glob('../../../public/subjects/**/*.{png,svg,webp}')))

const index = parseIndex(JSON.parse(indexText), 'subject index')

describe('subject index', () => {
  it('lists at least one subject, each only once (the picker uses the subject as its key)', () => {
    const subjects = index.subjects.map((s) => s.subject)
    expect(subjects.length).toBeGreaterThan(0)
    expect(new Set(subjects).size).toBe(subjects.length)
    // The hand-made demo pack is only for the canvas test page now; real packs replace it in the picker.
    expect(index.subjects.flatMap((s) => Object.values(s.packs)).filter((id) => id.startsWith('demo-'))).toEqual([])
  })

  it('points every listed pack at a folder with a valid pack.json of that difficulty', () => {
    for (const entry of index.subjects) {
      for (const [difficulty, id] of Object.entries(entry.packs)) {
        const text = packFiles[`${SUBJECTS}${id}/pack.json`]
        expect(text, `${entry.subject} ${difficulty}: no folder ${id}/ with a pack.json`).toBeDefined()
        const pack = parsePack(JSON.parse(text), `pack "${id}"`) // throws, naming the field, if the shape is wrong
        expect(pack.id, `pack ${id}: id must match its folder`).toBe(id)
        expect(pack.difficulty, `pack ${id}`).toBe(difficulty)
        expect(pack.subject, `pack ${id}`).toBe(entry.subject)
      }
    }
  })

  it('gives every listed pack the six pipeline stages, a chosen drawing that is one of the candidates, and 6-60 strokes', () => {
    for (const entry of index.subjects) {
      for (const id of Object.values(entry.packs)) {
        const pack = parsePack(JSON.parse(packFiles[`${SUBJECTS}${id}/pack.json`]), `pack "${id}"`)
        expect(pack.pipeline.map((s) => s.id), `pack ${id}`).toEqual(['source', 'candidates', 'chosen', 'skeleton', 'parts', 'order'])
        const stage = (stageId: string) => pack.pipeline.find((s) => s.id === stageId)!
        // The "How this lesson was made" panel highlights the chosen drawing by comparing these paths exactly.
        if (stage('chosen').image) expect(stage('candidates').images, `pack ${id}`).toContain(stage('chosen').image)
        for (const path of pack.pipeline.flatMap((s) => [s.image, ...(s.images ?? [])]).filter((p): p is string => !!p)) {
          expect(imageFiles.has(`${SUBJECTS}${id}/${path}`), `pack ${id}: ${path}`).toBe(true)
        }
        const drawn = pack.strokes.filter((s) => s.tier !== 'construction').length
        if (!id.startsWith('demo-')) {
          expect(drawn, `pack ${id}: strokes`).toBeGreaterThanOrEqual(6)
          expect(drawn, `pack ${id}: strokes`).toBeLessThanOrEqual(60)
        }
      }
    }
  })

  it('points every thumbnail and target image at a file that exists', () => {
    for (const entry of index.subjects) {
      expect(imageFiles.has(SUBJECTS + entry.thumb), `${entry.subject}: thumb ${entry.thumb}`).toBe(true)
      for (const id of Object.values(entry.packs)) {
        const pack = parsePack(JSON.parse(packFiles[`${SUBJECTS}${id}/pack.json`]), `pack "${id}"`)
        for (const path of [pack.target, pack.thumb]) {
          expect(imageFiles.has(`${SUBJECTS}${id}/${path}`), `pack ${id}: ${path}`).toBe(true)
        }
      }
    }
  })
})
