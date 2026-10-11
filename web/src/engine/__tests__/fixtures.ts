// Small hand-made packs and drawings for the tests. Coordinates are in 768 x 768 space.
import type { Pack, PlanStroke, Point, Step, UserStroke } from '../types'

// n + 1 evenly spaced points from (x1, y1) to (x2, y2).
function line(x1: number, y1: number, x2: number, y2: number, n = 4): Point[] {
  return Array.from({ length: n + 1 }, (_, i): Point => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n])
}

// A tiny fox: 4 parts, 8 strokes across all four tiers, 5 steps.
export const foxPack: Pack = {
  id: 'fox-test',
  subject: 'fox',
  title: 'Fox',
  difficulty: 'medium',
  size: 768,
  source: { kind: 'prompt', prompt: 'a sitting fox' },
  target: 'target.webp',
  thumb: 'thumb.webp',
  parts: [
    { id: 'head', label: 'Head', box: [300, 120, 170, 150] },
    { id: 'body', label: 'Body', box: [260, 260, 260, 240] },
    { id: 'tail', label: 'Tail', box: [480, 380, 200, 110] },
    { id: 'ear', label: 'Ear', box: [320, 70, 60, 60] },
  ],
  strokes: [
    { id: 'c1', points: line(300, 195, 470, 195), tier: 'construction', partId: 'head', keyPoints: [[300, 195], [470, 195]] },
    { id: 'c2', points: line(260, 380, 520, 380), tier: 'construction', partId: 'body', keyPoints: [[260, 380], [520, 380]] },
    { id: 'o1', points: line(300, 120, 470, 270), tier: 'outline', partId: 'head', keyPoints: [[300, 120], [385, 195], [470, 270]] },
    { id: 'o2', points: line(260, 260, 520, 500), tier: 'outline', partId: 'body', keyPoints: [] },
    { id: 's1', points: line(480, 380, 680, 490), tier: 'structure', partId: 'tail', keyPoints: [[480, 380], [680, 490]] },
    { id: 's2', points: line(320, 130, 350, 70), tier: 'structure', partId: 'ear', keyPoints: [[320, 130], [350, 70]] },
    { id: 'd1', points: line(360, 180, 370, 185, 2), tier: 'detail', partId: 'head', keyPoints: [[360, 180]] },
    { id: 'd2', points: line(640, 470, 680, 490, 2), tier: 'detail', partId: null, keyPoints: [[640, 470]] },
  ],
  steps: [
    { id: 'step-construct', label: 'Big shapes', tip: 'Start light.', tier: 'construction', strokeIds: ['c1', 'c2'] },
    { id: 'step-head', label: 'Head', tip: 'Follow the curve.', tier: 'outline', strokeIds: ['o1'] },
    { id: 'step-body', label: 'Body', tip: 'One long stroke.', tier: 'outline', strokeIds: ['o2'] },
    { id: 'step-tail', label: 'Tail and ear', tip: 'Keep it loose.', tier: 'structure', strokeIds: ['s1', 's2'] },
    { id: 'step-details', label: 'Details', tip: 'Small and dark.', tier: 'detail', strokeIds: ['d1', 'd2'] },
  ],
  pipeline: [
    { id: 'source', label: 'Prompt', text: 'a sitting fox' },
    { id: 'candidates', label: 'Candidates', images: ['c0.webp', 'c1.webp', 'c2.webp', 'c3.webp'] },
    { id: 'chosen', label: 'Chosen', image: 'chosen.webp' },
  ],
}

// A pack with n one-stroke steps, long enough to watch auto mode fade.
export function makeLongPack(n: number): Pack {
  const ids = Array.from({ length: n }, (_, i) => `s${i}`)
  return {
    ...foxPack,
    id: 'long-test',
    parts: [foxPack.parts[0]],
    strokes: ids.map((id, i): PlanStroke => ({ id, points: line(100, 100 + i * 20, 600, 100 + i * 20), tier: 'outline', partId: 'head', keyPoints: [] })),
    steps: ids.map((id): Step => ({ id: `step-${id}`, label: id, tip: '', tier: 'outline', strokeIds: [id] })),
  }
}

// A short user stroke starting at (x, y): [x, y, pressure, ms since stroke start] points.
export function strokeAt(x: number, y: number): UserStroke {
  return { points: [[x, y, 0.5, 0], [x + 20, y + 10, 0.6, 16], [x + 40, y + 15, 0.5, 32]] }
}

// A user drawing of a few strokes. Different seeds give different drawings.
export function drawing(seed: number): UserStroke[] {
  return [strokeAt(100 + seed, 100), strokeAt(200, 200 + seed), strokeAt(300 + seed, 300 + seed)]
}
