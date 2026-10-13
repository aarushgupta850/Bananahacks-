// Client for the optional live generation server (server/api.py, reached through a tunnel).
// The app must work fully without it, so: getLiveUrl and checkLive never throw, and generate only ever
// throws a LiveError whose `kind` tells the UI which friendly message to show.
// The server's address lives in public/live.json ({"url": ""}), so it can change without a rebuild.
import type { Difficulty, Pack } from '../engine/types'
import { parsePack } from './packs'

const CONFIG_TIMEOUT_MS = 2_000
// Through the free tunnel, and while the server is busy making someone else's lesson, /health can take a few
// seconds: with a 2 s limit the app wrongly said "offline" while the server was up. Two tries of 6 s each.
const HEALTH_TIMEOUT_MS = 6_000
const HEALTH_TRIES = 2
// The server makes one lesson at a time and answers "busy" (503) to anyone else. Instead of giving up at once,
// the app waits and asks again, a few times (a lesson takes about 20 s).
export const BUSY_RETRIES = 4
export const BUSY_WAIT_MS = 6_000
// A lesson takes the GPU PC about 18-24 s with SDXL, longer when OpenAI draws (server/pipeline/openai_images.py).
// The server gives up at 35 s (75 s with OpenAI), so the app waits a little longer than that.
const GENERATE_TIMEOUT_MS = 80_000

// offline: no server configured or unreachable; timeout: no answer in time; busy: already running a job
// (HTTP 429/503); rejected: the server refused the request, e.g. a blocked prompt (HTTP 400/422);
// failed: anything else, including a pack that doesn't match the contract.
export type LiveErrorKind = 'offline' | 'timeout' | 'busy' | 'rejected' | 'failed'

export class LiveError extends Error {
  kind: LiveErrorKind
  constructor(kind: LiveErrorKind, message: string) {
    super(message)
    this.name = 'LiveError'
    this.kind = kind
  }
}

export interface GenerateRequest {
  prompt?: string
  imageBase64?: string
  difficulty: Difficulty
}

// fetch that gives up after `ms` milliseconds. Failures come back as a LiveError ('timeout' or 'offline').
// AbortController + setTimeout instead of AbortSignal.timeout, so it also works on older iPad Safari.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    if (controller.signal.aborted) throw new LiveError('timeout', `No answer from ${url} within ${ms / 1000} s`)
    throw new LiveError('offline', `Could not reach ${url}`)
  } finally {
    clearTimeout(timer)
  }
}

// The server's base URL without a trailing slash, or '' when there is none.
export async function getLiveUrl(): Promise<string> {
  try {
    // no-store: pick up a new tunnel URL as soon as live.json changes.
    const response = await fetchWithTimeout(import.meta.env.BASE_URL + 'live.json', { cache: 'no-store' }, CONFIG_TIMEOUT_MS)
    if (!response.ok) return ''
    const data: unknown = await response.json()
    const url = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined
    return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

// True when the live server answers GET /health (two tries of 6 s each). Never throws.
export async function checkLive(): Promise<boolean> {
  const url = await getLiveUrl()
  if (!url) return false
  for (let attempt = 0; attempt < HEALTH_TRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(`${url}/health`, {}, HEALTH_TIMEOUT_MS)
      if (response.ok) return true
    } catch {
      // try again
    }
  }
  return false
}

// Sends a request, and while the server answers "busy", waits BUSY_WAIT_MS and sends it again (at most
// BUSY_RETRIES more times). onBusy is told each time it has to wait (to show "you're next").
async function retryWhileBusy<T>(send: () => Promise<T>, onBusy?: (wait: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send()
    } catch (error) {
      if (!(error instanceof LiveError) || error.kind !== 'busy' || attempt >= BUSY_RETRIES) throw error
      onBusy?.(attempt + 1)
      await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS))
    }
  }
}

const PHOTO_MAX_SIDE = 1536 // px: the server's line-art detector works at 1024 anyway

// Re-encodes any photo the browser can open (iPhone HEIC in Safari, WebP, GIF, huge JPEGs) as a JPEG of at most
// 1536 px, as base64. The server only takes JPEG, PNG or WebP up to 15 MB, and a smaller upload is faster too.
// If the browser can't open it (or this isn't a browser, as in tests), the original goes to the server unchanged.
export async function photoAsJpeg(base64: string): Promise<string> {
  if (typeof document === 'undefined') return base64
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes]))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return base64
      ctx.fillStyle = '#ffffff' // transparent PNGs become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return base64
  }
}

// Asks the live server to build a pack from a prompt or a photo (base64). Takes up to 80 s.
export async function generate(request: GenerateRequest, onBusy?: (wait: number) => void): Promise<Pack> {
  if (!request.prompt && !request.imageBase64) throw new LiveError('rejected', 'generate needs a prompt or a photo')
  const imageBase64 = request.imageBase64 ? await photoAsJpeg(request.imageBase64) : undefined
  return retryWhileBusy(() => postForPack('/generate', { ...request, imageBase64 }), onBusy)
}

export interface RegenerateRequest {
  prompt: string        // the lesson's subject, e.g. "a fox"
  canvasBase64: string  // PNG of the user's canvas so far (768 x 768), without the "data:image/png;base64," prefix
  difficulty: Difficulty
}

// "Happy accidents" (only behind ?happy=1): asks the live server to redraw the target around what the user has
// drawn so far. Returns a new pack without the lines already drawn; start a new Teacher on it with
// engine.createTeacher(pack, pack.steps, mode). Same errors and 80 s limit as generate.
export async function regenerate(request: RegenerateRequest): Promise<Pack> {
  return postForPack('/regenerate', request)
}

// POSTs JSON to the live server and returns the checked pack it answers with.
async function postForPack(path: string, request: object): Promise<Pack> {
  const url = await getLiveUrl()
  if (!url) throw new LiveError('offline', 'No live server is configured in live.json')

  const response = await fetchWithTimeout(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }, GENERATE_TIMEOUT_MS)

  if (response.status === 429 || response.status === 503) throw new LiveError('busy', `The live server is busy (HTTP ${response.status})`)
  if (response.status === 400 || response.status === 422) throw new LiveError('rejected', `The live server refused the request (HTTP ${response.status})`)
  if (!response.ok) throw new LiveError('failed', `The live server failed (HTTP ${response.status})`)

  try {
    return parsePack(await response.json(), 'live pack')
  } catch (error) {
    throw new LiveError('failed', error instanceof Error ? error.message : 'The live server sent an unreadable pack')
  }
}
