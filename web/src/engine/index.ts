// The one engine the UI talks to. UI code imports `engine` from here and nothing else in src/engine.
// ?engine=mock in the URL, or VITE_ENGINE=mock at build time, forces the mock engine.
import { mockEngine } from './mock'
import { realEngine } from './real'
import type { Engine } from './types'

function wantsMock(): boolean {
  if (import.meta.env.VITE_ENGINE === 'mock') return true
  // window doesn't exist when tests import this file in Node.
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('engine') === 'mock'
}

const useMock = wantsMock()

export const engine: Engine = useMock ? mockEngine : realEngine

console.info(`[Ghost Lines] using the ${useMock ? 'mock' : 'real'} engine`)
