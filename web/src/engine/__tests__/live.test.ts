import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUSY_RETRIES, BUSY_WAIT_MS, checkLive, generate, getLiveUrl, LiveError, PHOTO_OPEN_TIMEOUT_MS, PHOTO_TOO_BIG, PHOTO_TOO_SLOW, PHOTO_UNREADABLE,
  preparePhoto, regenerate,
} from '../../lib/live'
import { foxPack } from './fixtures'

// Replaces the global fetch: live.json answers with `liveUrl`, every other URL goes to `server`.
function fakeFetch(liveUrl: string, server: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    url.endsWith('live.json') ? Promise.resolve(Response.json({ url: liveUrl })) : server(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// A fetch that never answers until it is aborted, like a server that hangs.
function hang(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}

// Awaits a promise that should reject and returns the LiveError it rejected with.
async function liveErrorFrom(promise: Promise<unknown>): Promise<LiveError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(LiveError)
  return error as LiveError
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live server client', () => {
  it('reads the URL from live.json without a trailing slash', async () => {
    fakeFetch(' http://gpu.example.test/ ', hang)
    expect(await getLiveUrl()).toBe('http://gpu.example.test')
  })

  it('is offline when live.json has no URL', async () => {
    const fetchMock = fakeFetch('', hang)
    expect(await checkLive()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1) // only live.json, no health check
  })

  it('is offline, without throwing, when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await checkLive()).toBe(false)
  })

  it('is online when /health answers', async () => {
    const fetchMock = fakeFetch('http://gpu.example.test', () => Promise.resolve(new Response('ok')))
    expect(await checkLive()).toBe(true)
    expect(fetchMock).toHaveBeenLastCalledWith('http://gpu.example.test/health', expect.anything())
  })

  it('gives /health two tries of 6 seconds before saying offline', async () => {
    vi.useFakeTimers()
    fakeFetch('http://gpu.example.test', hang)
    let done = false
    const result = checkLive().then((ok) => { done = true; return ok })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(done).toBe(false) // a slow first answer gets a second chance
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await result).toBe(false)
  })

  it('is online when a slow first /health is followed by a quick one', async () => {
    vi.useFakeTimers()
    let calls = 0
    fakeFetch('http://gpu.example.test', (url, init) => (++calls === 1 ? hang(url, init) : Promise.resolve(new Response('ok'))))
    const result = checkLive()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await result).toBe(true)
  })

  it('waits and asks again while the server is busy, and says so', async () => {
    vi.useFakeTimers()
    let calls = 0
    fakeFetch('http://gpu.example.test', () => (++calls <= 2
      ? Promise.resolve(new Response('busy', { status: 503 }))
      : Promise.resolve(Response.json(foxPack))))
    const waits: number[] = []
    const result = generate({ prompt: 'a fox', difficulty: 'medium' }, (wait) => waits.push(wait))
    await vi.advanceTimersByTimeAsync(2 * BUSY_WAIT_MS)
    expect(await result).toEqual(foxPack)
    expect(waits).toEqual([1, 2])
  })

  it('gives up as busy after a few tries', async () => {
    vi.useFakeTimers()
    fakeFetch('http://gpu.example.test', () => Promise.resolve(new Response('busy', { status: 503 })))
    const result = liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))
    await vi.advanceTimersByTimeAsync(BUSY_RETRIES * BUSY_WAIT_MS)
    expect((await result).kind).toBe('busy')
  })

  it('returns a checked pack from /generate', async () => {
    const fetchMock = fakeFetch('http://gpu.example.test', () => Promise.resolve(Response.json(foxPack)))
    expect(await generate({ prompt: 'a fox', difficulty: 'medium' })).toEqual(foxPack)
    const [url, init] = fetchMock.mock.lastCall!
    expect(url).toBe('http://gpu.example.test/generate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'a fox', difficulty: 'medium' })
  })

  it('reports each kind of failure so the UI can pick a friendly message', async () => {
    fakeFetch('', hang)
    expect((await liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))).kind).toBe('offline')

    fakeFetch('http://gpu.example.test', () => Promise.resolve(new Response('no', { status: 400 })))
    expect((await liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))).kind).toBe('rejected')

    fakeFetch('http://gpu.example.test', () => Promise.resolve(Response.json({ id: 'broken' })))
    expect((await liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))).kind).toBe('failed')
  })

  it('waits 80 seconds for /generate, then times out', async () => {
    vi.useFakeTimers()
    fakeFetch('http://gpu.example.test', hang)
    let settled = false
    const result = liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' })).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(75_000)
    expect(settled).toBe(false) // a slow lesson (OpenAI can take over 60 s) still arrives
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await result).kind).toBe('timeout')
  })

  it('sends Happy accidents requests to /regenerate and checks the pack', async () => {
    const fetchMock = fakeFetch('http://gpu.example.test', () => Promise.resolve(Response.json(foxPack)))
    const pack = await regenerate({ prompt: 'a fox', canvasBase64: 'AAAA', difficulty: 'medium' })
    expect(pack.id).toBe(foxPack.id)
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('http://gpu.example.test/regenerate')
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'a fox', canvasBase64: 'AAAA', difficulty: 'medium' })
  })

  it("passes on the server's own reason for refusing, when it is written for users", async () => {
    const reason = "Couldn't tell what's in that photo. Try one object on a plain background, or type what it is."
    fakeFetch('http://gpu.example.test', () => Promise.resolve(Response.json({ error: reason }, { status: 422 })))
    const error = await liveErrorFrom(generate({ imageBase64: 'AAAA', difficulty: 'medium' }))
    expect(error.kind).toBe('rejected')
    expect(error.userMessage).toBe(reason)
  })

  it('leaves out a refusal reason that is only a word, or not JSON at all', async () => {
    fakeFetch('http://gpu.example.test', () => Promise.resolve(Response.json({ error: 'failed' }, { status: 400 })))
    expect((await liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))).userMessage).toBeUndefined()
    fakeFetch('http://gpu.example.test', () => Promise.resolve(new Response('<html>Bad request</html>', { status: 400 })))
    expect((await liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' }))).userMessage).toBeUndefined()
  })
})

describe('getting a chosen photo ready', () => {
  it('says an empty file or one the browser cannot open is unreadable', async () => {
    const empty = await liveErrorFrom(preparePhoto(new File([], 'empty.jpg', { type: 'image/jpeg' })))
    expect(empty.userMessage).toBe(PHOTO_UNREADABLE)
    // Tests run outside a browser, where nothing can be decoded: the same as a HEIC photo in Chrome.
    const heic = await liveErrorFrom(preparePhoto(new File([new Uint8Array([1, 2, 3])], 'IMG_0001.HEIC', { type: 'image/heic' })))
    expect(heic.kind).toBe('rejected')
    expect(heic.userMessage).toBe(PHOTO_UNREADABLE)
  })

  it('says a huge file is too big, without opening it', async () => {
    const huge = { name: 'huge.jpg', type: 'image/jpeg', size: 61 * 1024 * 1024 } as File
    expect((await liveErrorFrom(preparePhoto(huge))).userMessage).toBe(PHOTO_TOO_BIG)
  })

  it('gives up with a message when the browser stalls opening a photo, instead of "Opening photo…" forever', async () => {
    vi.useFakeTimers()
    // An image that never finishes decoding.
    vi.stubGlobal('Image', class { src = ''; decode() { return new Promise(() => {}) } })
    const result = liveErrorFrom(preparePhoto(new File([new Uint8Array([1, 2, 3])], 'slow.jpg', { type: 'image/jpeg' })))
    await vi.advanceTimersByTimeAsync(PHOTO_OPEN_TIMEOUT_MS)
    const error = await result
    expect(error.kind).toBe('timeout')
    expect(error.userMessage).toBe(PHOTO_TOO_SLOW)
  })
})
