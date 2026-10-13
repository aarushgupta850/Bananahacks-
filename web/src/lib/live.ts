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
  // Words for the user, when there are better ones than the general message for `kind`: the server's own reason
  // for refusing a request ("The photo must be 15 MB or less."), or why a chosen photo can't be used.
  userMessage?: string
  constructor(kind: LiveErrorKind, message: string, userMessage?: string) {
    super(message)
    this.name = 'LiveError'
    this.kind = kind
    this.userMessage = userMessage
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
const PHOTO_MAX_FILE_BYTES = 60 * 1024 * 1024 // bigger than any phone photo; anything larger isn't worth decoding

// Opening a photo takes under 1 s (a 59 MB PNG measured 0.9 s). If a browser stalls (an old iPad with a huge photo),
// "Opening photo…" must not stay up forever with the button locked, so it gives up after this long.
export const PHOTO_OPEN_TIMEOUT_MS = 20_000

export const PHOTO_UNREADABLE = "This browser can't open that file. Try a JPEG or PNG photo."
export const PHOTO_TOO_BIG = 'That file is too big. Try a smaller photo.'
export const PHOTO_TOO_SLOW = 'That photo took too long to open. Try a smaller photo.'

// Opens an image (a blob: URL) and draws it as a JPEG of at most 1536 px, as base64 without the data: prefix.
// The browser turns phone photos the right way up while decoding, and transparent PNGs get a white background.
// Throws if the browser can't open it.
async function urlAsJpeg(url: string): Promise<string> {
  const img = new Image()
  img.src = url
  await img.decode()
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('The image has no size')
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas')
  ctx.fillStyle = '#ffffff' // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const jpeg = canvas.toDataURL('image/jpeg', 0.9)
  // A canvas the browser couldn't allocate gives "data:," (no picture at all).
  if (!jpeg.startsWith('data:image/jpeg')) throw new Error('The canvas gave no JPEG')
  return jpeg.split(',')[1]
}

// Gets a chosen photo ready to send, as soon as it is picked: a JPEG of at most 1536 px, as base64 (also shown as
// the preview). The server only takes JPEG, PNG or WebP up to 15 MB; this way any photo the browser can open works
// (iPhone HEIC in Safari, WebP, GIF, huge JPEGs), and a file it can't open is caught now, with words that say what
// to do, instead of after "Make my lesson". The file's own type goes with it, so the browser decodes it as that.
// Throws a LiveError ('rejected', or 'timeout' after PHOTO_OPEN_TIMEOUT_MS) whose userMessage says what went wrong.
export async function preparePhoto(file: File): Promise<string> {
  if (file.size === 0) throw new LiveError('rejected', `${file.name} is empty`, PHOTO_UNREADABLE)
  if (file.size > PHOTO_MAX_FILE_BYTES) throw new LiveError('rejected', `${file.name} is ${file.size} bytes`, PHOTO_TOO_BIG)
  const url = URL.createObjectURL(file)
  let timer: ReturnType<typeof setTimeout> | undefined
  const tooSlow = new Promise<never>((_resolve, reject) => {
    const giveUp = () => {
      // A hidden page (the user switched apps right after choosing) puts off decoding until it is shown again,
      // so a page that is hidden at the deadline gets another full wait instead of a "too long" message.
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(giveUp, PHOTO_OPEN_TIMEOUT_MS)
        return
      }
      reject(new LiveError('timeout', `Opening ${file.name} took over ${PHOTO_OPEN_TIMEOUT_MS / 1000} s`, PHOTO_TOO_SLOW))
    }
    timer = setTimeout(giveUp, PHOTO_OPEN_TIMEOUT_MS)
  })
  try {
    return await Promise.race([urlAsJpeg(url), tooSlow])
  } catch (error) {
    if (error instanceof LiveError) throw error
    throw new LiveError('rejected', `Could not open ${file.name} (${file.type || 'unknown type'}): ${String(error)}`, PHOTO_UNREADABLE)
  } finally {
    clearTimeout(timer)
    URL.revokeObjectURL(url)
  }
}

// Re-encodes a photo (base64) as a JPEG of at most 1536 px, like preparePhoto, for requests made without it.
// If the browser can't open it (or this isn't a browser, as in tests), the original goes to the server unchanged,
// and the server says whether it can use it.
export async function photoAsJpeg(base64: string): Promise<string> {
  if (typeof document === 'undefined') return base64
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes]))
    try {
      return await urlAsJpeg(url)
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

// The reason a refusal gives, {"error": "..."}, when it is a sentence written for users (server/api.py words them
// that way: "Couldn't tell what's in that photo. Try one object on a plain background, or type what it is.").
// Single words ("busy", "failed") and anything long or odd are left out: then the app's own message is shown.
async function serverReason(response: Response): Promise<string | undefined> {
  try {
    const data: unknown = await response.json()
    const reason = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined
    if (typeof reason !== 'string') return undefined
    const text = reason.trim()
    return text.length >= 8 && text.length <= 200 && text.includes(' ') && !/[<>{}]/.test(text) ? text : undefined
  } catch {
    return undefined
  }
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
  if (response.status === 400 || response.status === 422) {
    throw new LiveError('rejected', `The live server refused the request (HTTP ${response.status})`, await serverReason(response))
  }
  if (!response.ok) throw new LiveError('failed', `The live server failed (HTTP ${response.status})`)

  try {
    return parsePack(await response.json(), 'live pack')
  } catch (error) {
    throw new LiveError('failed', error instanceof Error ? error.message : 'The live server sent an unreadable pack')
  }
}
