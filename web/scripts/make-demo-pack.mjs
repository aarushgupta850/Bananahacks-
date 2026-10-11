// Builds the hand-made demo pack in public/subjects/demo-fox-medium: pack.json, target.svg and thumb.svg.
// The fox lives only in this file, so the plan strokes and both images always come from the same points.
// Run from web/:  node scripts/make-demo-pack.mjs
// The test in src/engine/__tests__/demoPack.test.ts checks the output against the contract.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 768
const PACK_ID = 'demo-fox-medium'
const OUT_DIR = fileURLToPath(new URL(`../public/subjects/${PACK_ID}/`, import.meta.url))
const BOX_PADDING = 8 // part boxes get a little air around their strokes, like a detector's boxes would

// ---------- shape helpers (all points are [x, y] in 768 x 768 space, rounded to whole pixels) ----------

const round = ([x, y]) => [Math.round(x), Math.round(y)]

// A closed ellipse as `count` points plus the first point again, starting at the top and going clockwise.
function ellipse(cx, cy, rx, ry, count = 48) {
  const points = []
  for (let i = 0; i <= count; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count
    points.push(round([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]))
  }
  return points
}

const circle = (cx, cy, r) => ellipse(cx, cy, r, r)

// The 4 extremes of an ellipse (top, right, bottom, left), used as its key points.
const extremes = (cx, cy, rx, ry) => [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]]

// Straight segments through `corners`, with extra points every ~12 px so every stroke is evenly sampled.
function polyline(corners, spacing = 12) {
  const points = [corners[0]]
  for (let i = 1; i < corners.length; i++) {
    const [x1, y1] = corners[i - 1]
    const [x2, y2] = corners[i]
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / spacing))
    for (let s = 1; s <= steps; s++) points.push(round([x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps]))
  }
  return points
}

// A smooth curve that passes through every waypoint (a Catmull-Rom spline), `perSegment` points between each pair.
// For the segment p1 -> p2 the curve also looks at the neighbours p0 and p3, which is what makes it smooth.
function curve(waypoints, perSegment = 8) {
  const at = (i) => waypoints[Math.min(Math.max(i, 0), waypoints.length - 1)]
  const points = [waypoints[0]]
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    for (let s = 1; s <= perSegment; s++) {
      const t = s / perSegment
      const t2 = t * t
      const t3 = t2 * t
      const coord = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
      points.push(round([coord(0), coord(1)]))
    }
  }
  return points
}

// ---------- the fox ----------
// A sitting fox facing us, head centered on x = 280, tail curling up on the right.

const HEAD = { cx: 280, cy: 250, r: 90 }
const BODY = { cx: 280, cy: 500, rx: 115, ry: 145 }

// Hand-picked waypoints. Curves pass through them, and they double as the key points the Hints mode shows.
const HEAD_OUTLINE = [[210, 210], [204, 265], [238, 318], [280, 348], [322, 318], [356, 265], [350, 210]]
const CROWN = [[258, 168], [280, 162], [302, 168]]
const EAR_LEFT = [[210, 210], [202, 100], [258, 168]]
const EAR_RIGHT = [[350, 210], [358, 100], [302, 168]]
const BODY_OUTLINE = [[242, 338], [195, 420], [172, 525], [190, 615], [280, 648], [370, 615], [388, 525], [365, 420], [318, 338]]
const TAIL = [[375, 625], [480, 650], [570, 610], [620, 520], [615, 430], [585, 385], [570, 430], [560, 510], [510, 570], [390, 575]]
const TAIL_TIP = [[618, 478], [592, 464], [565, 472]]
const EYE_LEFT = [[238, 252], [253, 244], [268, 252]]
const EYE_RIGHT = [[292, 252], [307, 244], [322, 252]]
const NOSE = [[270, 302], [290, 302], [280, 316], [270, 302]]

// In plan order: construction first, then outlines, structure and details, grouped by the steps below.
const strokes = [
  { id: 'c-head', tier: 'construction', partId: 'head', points: circle(HEAD.cx, HEAD.cy, HEAD.r), keyPoints: extremes(HEAD.cx, HEAD.cy, HEAD.r, HEAD.r) },
  { id: 'c-body', tier: 'construction', partId: 'body', points: ellipse(BODY.cx, BODY.cy, BODY.rx, BODY.ry), keyPoints: extremes(BODY.cx, BODY.cy, BODY.rx, BODY.ry) },
  { id: 'o-head', tier: 'outline', partId: 'head', points: curve(HEAD_OUTLINE), keyPoints: HEAD_OUTLINE },
  { id: 'o-crown', tier: 'outline', partId: 'head', points: curve(CROWN), keyPoints: CROWN },
  { id: 's-ear-left', tier: 'structure', partId: 'ears', points: polyline(EAR_LEFT), keyPoints: EAR_LEFT },
  { id: 's-ear-right', tier: 'structure', partId: 'ears', points: polyline(EAR_RIGHT), keyPoints: EAR_RIGHT },
  { id: 'o-body', tier: 'outline', partId: 'body', points: curve(BODY_OUTLINE), keyPoints: BODY_OUTLINE },
  { id: 'o-tail', tier: 'outline', partId: 'tail', points: curve(TAIL), keyPoints: TAIL },
  { id: 's-tail-tip', tier: 'structure', partId: 'tail', points: curve(TAIL_TIP), keyPoints: TAIL_TIP },
  { id: 'd-eye-left', tier: 'detail', partId: 'eyes', points: curve(EYE_LEFT, 4), keyPoints: EYE_LEFT },
  { id: 'd-eye-right', tier: 'detail', partId: 'eyes', points: curve(EYE_RIGHT, 4), keyPoints: EYE_RIGHT },
  // The nose closes on itself, so its last corner repeats the first; that duplicate isn't a key point.
  { id: 'd-nose', tier: 'detail', partId: 'head', points: polyline(NOSE, 6), keyPoints: NOSE.slice(0, 3) },
]

const steps = [
  { id: 'step-shapes', label: 'Big shapes', tier: 'construction', strokeIds: ['c-head', 'c-body'],
    tip: 'Sketch a light circle for the head and a tall oval for the body. Keep them loose.' },
  { id: 'step-head', label: 'Head', tier: 'outline', strokeIds: ['o-head', 'o-crown'],
    tip: 'Run from one cheek down to a pointed chin and up the other side, then close the top.' },
  { id: 'step-ears', label: 'Ears', tier: 'structure', strokeIds: ['s-ear-left', 's-ear-right'],
    tip: 'Two tall triangles sitting on the top corners of the head.' },
  { id: 'step-body', label: 'Body', tier: 'outline', strokeIds: ['o-body'],
    tip: 'One long curve from the neck, around the bottom and back up.' },
  { id: 'step-tail', label: 'Tail', tier: 'outline', strokeIds: ['o-tail', 's-tail-tip'],
    tip: 'Sweep the tail out to the right and curl it back to the body. Then mark the white tip.' },
  { id: 'step-face', label: 'Face', tier: 'detail', strokeIds: ['d-eye-left', 'd-eye-right', 'd-nose'],
    tip: 'Two small eyes level with each other, and a little nose near the chin.' },
]

const PART_LABELS = { head: 'Head', body: 'Body', ears: 'Ears', eyes: 'Eyes', tail: 'Tail' }

// Each part's box is the bounding box of its strokes, padded and kept inside the canvas.
function partBox(partId) {
  const points = strokes.filter((s) => s.partId === partId).flatMap((s) => s.points)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.max(0, Math.min(...xs) - BOX_PADDING)
  const top = Math.max(0, Math.min(...ys) - BOX_PADDING)
  const right = Math.min(SIZE, Math.max(...xs) + BOX_PADDING)
  const bottom = Math.min(SIZE, Math.max(...ys) + BOX_PADDING)
  return [left, top, right - left, bottom - top]
}

// Head first: the mock engine's scripted story is about the head (and the part after it, the body).
const parts = Object.entries(PART_LABELS).map(([id, label]) => ({ id, label, box: partBox(id) }))

// No AI made this pack, so the pipeline stages say what a real pack does and what this one did instead.
const pipeline = [
  { id: 'source', label: 'Prompt', text: 'Real packs start from a text prompt or a photo. This demo fox was drawn by hand from points, so no AI was used for it.' },
  { id: 'candidates', label: 'Candidates', text: 'Real packs: an image model draws four line-art candidates. The demo has none.' },
  { id: 'chosen', label: 'Chosen drawing', text: 'Real packs: the cleanest candidate becomes the drawing you copy. Here it is drawn straight from the lesson strokes.' },
  { id: 'skeleton', label: 'Traced lines', text: 'Real packs: the chosen drawing is thinned to 1 px lines and traced into strokes. Here the strokes were written by hand.' },
  { id: 'parts', label: 'Parts', text: 'Real packs: a detector finds and labels the parts. Here the head, body, ears, eyes and tail boxes come from the strokes.' },
  { id: 'order', label: 'Lesson order', text: 'Strokes are ordered the way an artist draws: big construction shapes first, then outlines, structure and details.' },
]

const pack = {
  id: PACK_ID,
  subject: 'fox',
  title: 'Fox (demo)',
  difficulty: 'medium',
  size: SIZE,
  source: { kind: 'prompt', prompt: 'a simple sitting fox (hand-made demo)' },
  target: 'target.svg',
  thumb: 'thumb.svg',
  parts,
  // Key order matches types.ts (id, points, tier, partId, keyPoints), so the JSON reads like the contract.
  strokes: strokes.map(({ id, points, tier, partId, keyPoints }) => ({ id, points, tier, partId, keyPoints })),
  steps: steps.map(({ id, label, tip, tier, strokeIds }) => ({ id, label, tip, tier, strokeIds })),
  pipeline,
}

// ---------- writing the files ----------

// JSON.stringify puts every number on its own line. Put short lists (points, boxes, id lists) on one line instead.
function formatJson(value) {
  return JSON.stringify(value, null, 2)
    .replace(/\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]/g, (_, nums) => `[${nums.split(/,\s*/).join(', ')}]`)
    .replace(/\[\s*(\[[^[\]]*\](?:,\s*\[[^[\]]*\])*)\s*\]/g, (_, inner) => `[${inner.replace(/,\s+/g, ', ')}]`)
    .replace(/\[\s*("[^"]*"(?:,\s*"[^"]*")*)\s*\]/g, (_, inner) => `[${inner.replace(/,\s+/g, ', ')}]`)
}

// Black round lines on white. The construction strokes are left out: the reference shows the finished fox,
// like a real target image would. `pixels` is the image size; the viewBox stays 768 so the points are unchanged.
function svg(pixels, strokeWidth) {
  const lines = strokes
    .filter((s) => s.tier !== 'construction')
    .map((s) => `    <polyline points="${s.points.map(([x, y]) => `${x},${y}`).join(' ')}"/>`)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    '  <!-- Generated by web/scripts/make-demo-pack.mjs. Edit that file, not this one. -->',
    `  <rect width="${SIZE}" height="${SIZE}" fill="#fff"/>`,
    `  <g fill="none" stroke="#000" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
    ...lines,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'pack.json'), formatJson(pack) + '\n')
writeFileSync(join(OUT_DIR, 'target.svg'), svg(SIZE, 4))
// The thumb is shown at 256 px, a third of 768, so its lines are 3x thicker to still look 4 px wide.
writeFileSync(join(OUT_DIR, 'thumb.svg'), svg(256, 12))
console.log(`Wrote ${strokes.length} strokes, ${steps.length} steps and ${parts.length} parts to ${OUT_DIR}`)
