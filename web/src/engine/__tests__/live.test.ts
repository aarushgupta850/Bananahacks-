import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUSY_RETRIES, BUSY_WAIT_MS, checkLive, generate, getLiveUrl, LiveError, regenerate } from '../../lib/live'
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

  it('waits 38 seconds for /generate, then times out', async () => {
    vi.useFakeTimers()
    fakeFetch('http://gpu.example.test', hang)
    let settled = false
    const result = liveErrorFrom(generate({ prompt: 'a fox', difficulty: 'medium' })).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false) // a slow lesson (the GPU PC can take over 25 s) still arrives
    await vi.advanceTimersByTimeAsync(8_000)
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
})
