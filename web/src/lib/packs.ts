// Loads the subject index and subject packs from public/subjects, and checks their shape at runtime.
// TypeScript types disappear when the app runs, so without these checks a broken pack.json would fail
// somewhere deep in the UI. Instead it fails here, with a message naming the exact field.
import type {
  Box, Difficulty, Pack, Part, PipelineStage, PlanStroke, Point, Step, SubjectIndex, Tier,
} from '../engine/types'

// BASE_URL is '/Bananahacks-/' on GitHub Pages, so this works both there and in dev.
const SUBJECTS_URL = import.meta.env.BASE_URL + 'subjects/'

const DIFFICULTIES: readonly Difficulty[] = ['simple', 'medium', 'detailed']
const TIERS: readonly Tier[] = ['construction', 'outline', 'structure', 'detail']
const STAGE_IDS: readonly PipelineStage['id'][] = ['source', 'candidates', 'chosen', 'skeleton', 'parts', 'order']

// ---------- loading ----------

export async function loadIndex(): Promise<SubjectIndex> {
  const label = 'subject index'
  return parseIndex(await fetchJson(SUBJECTS_URL + 'index.json', label), label)
}

export async function loadPack(id: string): Promise<Pack> {
  const label = `pack "${id}"`
  const pack = parsePack(await fetchJson(`${SUBJECTS_URL}${encodeURIComponent(id)}/pack.json`, label), label)
  // resolveAsset finds images through pack.id, so it has to match the folder name.
  if (pack.id !== id) throw new Error(`${label}: id is "${pack.id}" but the folder is "${id}". They must match.`)
  return pack
}

// Turns an asset path from a pack (target, thumb, pipeline images) into a URL the browser can load.
// data: URLs (live packs) and absolute http(s) URLs are used as they are.
export function resolveAsset(pack: Pack, path: string): string {
  if (isUsableAsIs(path)) return path
  return `${SUBJECTS_URL}${pack.id}/${stripLeadingSlash(path)}`
}

// The same for paths in index.json (thumbs there are relative to /subjects/, not to a pack folder).
export function resolveIndexAsset(path: string): string {
  if (isUsableAsIs(path)) return path
  return SUBJECTS_URL + stripLeadingSlash(path)
}

function isUsableAsIs(path: string): boolean {
  return path.startsWith('data:') || path.startsWith('http')
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\.?\//, '')
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new Error(`Could not load ${label}: the network request failed`)
  }
  if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error(`Could not load ${label}: the file is not valid JSON`)
  }
}

// ---------- shape checks ----------
// Each check takes `where`, a readable path like 'pack "fox-medium": strokes[3].points[7]',
// and throws an Error that starts with it.

function fail(where: string, problem: string): never {
  throw new Error(`${where} ${problem}`)
}

function expectRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where, 'must be an object')
  return value as Record<string, unknown>
}

function expectString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'must be a string')
  return value
}

function expectOptionalString(value: unknown, where: string): string | undefined {
  return value === undefined ? undefined : expectString(value, where)
}

function expectArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be a list')
  return value
}

function expectOneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (!options.includes(value as T)) {
    fail(where, `must be one of ${options.map((o) => `"${o}"`).join(', ')} (got ${JSON.stringify(value)})`)
  }
  return value as T
}

function expectNumbers(value: unknown, count: number, where: string, shape: string): number[] {
  const ok = Array.isArray(value) && value.length === count
    && value.every((n) => typeof n === 'number' && Number.isFinite(n))
  if (!ok) fail(where, `must be ${shape} numbers`)
  return [...(value as number[])]
}

const expectPoint = (value: unknown, where: string) => expectNumbers(value, 2, where, '[x, y]') as Point
const expectBox = (value: unknown, where: string) => expectNumbers(value, 4, where, '[x, y, w, h]') as Box

function expectPoints(value: unknown, where: string): Point[] {
  return expectArray(value, where).map((p, i) => expectPoint(p, `${where}[${i}]`))
}

function expectStrings(value: unknown, where: string): string[] {
  return expectArray(value, where).map((s, i) => expectString(s, `${where}[${i}]`))
}

// Checks raw JSON against the Pack type and returns a clean copy. `label` names the pack in errors.
export function parsePack(raw: unknown, label: string): Pack {
  const at = (path: string) => `${label}: ${path}`
  const p = expectRecord(raw, label)
  if (p.size !== 768) fail(at('size'), `must be 768 (got ${JSON.stringify(p.size)})`)
  const source = expectRecord(p.source, at('source'))

  const parts = expectArray(p.parts, at('parts')).map((item, i): Part => {
    const where = at(`parts[${i}]`)
    const r = expectRecord(item, where)
    return { id: expectString(r.id, `${where}.id`), label: expectString(r.label, `${where}.label`), box: expectBox(r.box, `${where}.box`) }
  })
  const partIds = new Set(parts.map((part) => part.id))

  const strokes = expectArray(p.strokes, at('strokes')).map((item, i): PlanStroke => {
    const where = at(`strokes[${i}]`)
    const r = expectRecord(item, where)
    const partId = r.partId === null ? null : expectString(r.partId, `${where}.partId`)
    if (partId !== null && !partIds.has(partId)) fail(`${where}.partId`, `refers to a part that doesn't exist ("${partId}")`)
    return {
      id: expectString(r.id, `${where}.id`),
      points: expectPoints(r.points, `${where}.points`),
      tier: expectOneOf(r.tier, TIERS, `${where}.tier`),
      partId,
      keyPoints: expectPoints(r.keyPoints, `${where}.keyPoints`),
    }
  })
  const strokeIds = new Set(strokes.map((stroke) => stroke.id))

  const steps = expectArray(p.steps, at('steps')).map((item, i): Step => {
    const where = at(`steps[${i}]`)
    const r = expectRecord(item, where)
    const ids = expectStrings(r.strokeIds, `${where}.strokeIds`)
    const unknown = ids.find((id) => !strokeIds.has(id))
    if (unknown !== undefined) fail(`${where}.strokeIds`, `refers to a stroke that doesn't exist ("${unknown}")`)
    return {
      id: expectString(r.id, `${where}.id`),
      label: expectString(r.label, `${where}.label`),
      tip: expectString(r.tip, `${where}.tip`),
      tier: expectOneOf(r.tier, TIERS, `${where}.tier`),
      strokeIds: ids,
    }
  })

  const pipeline = expectArray(p.pipeline, at('pipeline')).map((item, i): PipelineStage => {
    const where = at(`pipeline[${i}]`)
    const r = expectRecord(item, where)
    return {
      id: expectOneOf(r.id, STAGE_IDS, `${where}.id`),
      label: expectString(r.label, `${where}.label`),
      text: expectOptionalString(r.text, `${where}.text`),
      image: expectOptionalString(r.image, `${where}.image`),
      images: r.images === undefined ? undefined : expectStrings(r.images, `${where}.images`),
    }
  })

  return {
    id: expectString(p.id, at('id')),
    subject: expectString(p.subject, at('subject')),
    title: expectString(p.title, at('title')),
    difficulty: expectOneOf(p.difficulty, DIFFICULTIES, at('difficulty')),
    size: 768,
    source: {
      kind: expectOneOf(source.kind, ['prompt', 'photo'] as const, at('source.kind')),
      prompt: expectOptionalString(source.prompt, at('source.prompt')),
    },
    target: expectString(p.target, at('target')),
    thumb: expectString(p.thumb, at('thumb')),
    parts,
    strokes,
    steps,
    pipeline,
  }
}

// Checks raw JSON against the SubjectIndex type and returns a clean copy.
export function parseIndex(raw: unknown, label: string): SubjectIndex {
  const r = expectRecord(raw, label)
  const subjects = expectArray(r.subjects, `${label}: subjects`).map((item, i) => {
    const where = `${label}: subjects[${i}]`
    const s = expectRecord(item, where)
    const packs: Partial<Record<Difficulty, string>> = {}
    for (const [key, value] of Object.entries(expectRecord(s.packs, `${where}.packs`))) {
      packs[expectOneOf(key, DIFFICULTIES, `${where}.packs key`)] = expectString(value, `${where}.packs.${key}`)
    }
    return {
      subject: expectString(s.subject, `${where}.subject`),
      title: expectString(s.title, `${where}.title`),
      thumb: expectString(s.thumb, `${where}.thumb`),
      packs,
    }
  })
  return { subjects }
}
