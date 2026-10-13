// Measures a solo drawing (the test or the retest) against the target, part by part.
// Every number the report shows starts here.
import type { Analysis, Box, Pack, Part, PartMetric, Point, TimedPoint, UserStroke } from '../types'
import { align, targetPoints } from './align'
import { config } from './config'
import {
  applyTransform, bbox, boxCenter, clamp, diagonal, length, meanNearest, PointGrid, resample, symmetricChamfer,
} from './geometry'
import { isTap } from './match'

const round2 = (n: number) => Math.round(n * 100) / 100

// The angle of a point cloud's long axis in degrees (principal component), and how elongated it is
// (long spread / short spread). A round cloud has no meaningful angle, which is why the ratio is returned too.
function principalAxis(points: Point[]): { angleDeg: number; elongation: number } {
  if (points.length < 2) return { angleDeg: 0, elongation: 1 }
  const [cx, cy] = points.reduce(([x, y], p) => [x + p[0] / points.length, y + p[1] / points.length], [0, 0])
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - cx) ** 2
    syy += (y - cy) ** 2
    sxy += (x - cx) * (y - cy)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const spread = Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2)
  const major = (sxx + syy + spread) / 2
  const minor = Math.max((sxx + syy - spread) / 2, 1e-6)
  return { angleDeg: (angle * 180) / Math.PI, elongation: Math.sqrt(major / minor) }
}

// Difference between two axis angles, wrapped to -90..90 (an axis at 170 degrees is the same as one at -10).
function angleDifference(a: number, b: number): number {
  let d = a - b
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  return d
}

// The plan points of the visible strokes that belong to no part (partId null, as in most pipeline packs).
// User strokes that copy these lines must not be counted into a neighbouring part.
function unlabeledPoints(pack: Pack): Point[] {
  const partIds = new Set(pack.parts.map((p) => p.id))
  return pack.strokes
    .filter((s) => s.tier !== 'construction' && (s.partId === null || !partIds.has(s.partId)))
    .flatMap((s) => resample(s.points, config.alignPointsPerStroke))
}

// A user's box for a part, redrawn relative to the part's box in the pack. The screens draw pack.parts[].box
// as "target" and userBox as "yours", but the engine measures the user's strokes against the box around the
// part's plan strokes, which is smaller (detection boxes have a margin). This moves and scales the user's box
// the same way, so the two boxes on screen differ exactly as the measured errors say: a perfect copy shows
// the boxes on top of each other.
function inPartBoxFrame(userBox: Box, strokesBox: Box, partBox: Box): Box {
  const sx = partBox[2] / Math.max(strokesBox[2], 8) // 8 px floor, as for the width/height ratio
  const sy = partBox[3] / Math.max(strokesBox[3], 8)
  return [
    partBox[0] + (userBox[0] - strokesBox[0]) * sx,
    partBox[1] + (userBox[1] - strokesBox[1]) * sy,
    userBox[2] * sx,
    userBox[3] * sy,
  ]
}

// The plan points of each part: its visible strokes, else its construction shapes, else its box outline.
function partPointSets(pack: Pack): Map<string, Point[]> {
  const sets = new Map<string, Point[]>()
  for (const part of pack.parts) {
    const own = pack.strokes.filter((s) => s.partId === part.id)
    const visible = own.filter((s) => s.tier !== 'construction')
    const chosen = visible.length > 0 ? visible : own
    const [x, y, w, h] = part.box
    sets.set(part.id, chosen.length > 0
      ? chosen.flatMap((s) => resample(s.points, config.alignPointsPerStroke))
      : resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], config.alignPointsPerStroke))
  }
  return sets
}

// Smoothness from how much the line turns between samples. The median ignores a few real corners
// (a triangle ear has three), so only constant wobble counts as shaky.
function smoothness(stroke: Point[]): number {
  const p = resample(stroke, config.alignPointsPerStroke)
  const turns: number[] = []
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0])
    const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0])
    let turn = Math.abs(b - a)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    turns.push(turn)
  }
  if (turns.length === 0) return 1
  turns.sort((x, y) => x - y)
  return clamp(1 - turns[Math.floor(turns.length / 2)] / config.smoothTurnRad, 0, 1)
}

// Line confidence: the mean of smoothness and "1 - how many strokes just went over an earlier one".
function lineConfidence(strokes: Point[][]): number {
  if (strokes.length === 0) return 0
  const smooth = strokes.reduce((sum, s) => sum + smoothness(s), 0) / strokes.length
  let overstrokes = 0
  const earlier: Point[] = []
  const limit = config.overstrokeDistance ** 2
  for (const stroke of strokes) {
    const points = resample(stroke, config.alignPointsPerStroke)
    if (earlier.length > 0) {
      const close = points.filter((p) => earlier.some((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= limit)).length
      if (close / points.length >= config.overstrokeShare) overstrokes++
    }
    earlier.push(...points)
  }
  return clamp((smooth + (1 - overstrokes / strokes.length)) / 2, 0, 1)
}

// Small parts that sit inside a bigger one (the eyes inside the head): the parent whose box holds most of the
// child's box, if there is one.
function parentOf(child: Part, parts: Part[]): Part | null {
  const [cx, cy, cw, ch] = child.box
  let best: Part | null = null
  for (const p of parts) {
    if (p.id === child.id) continue
    const [px, py, pw, ph] = p.box
    const overlap = Math.max(0, Math.min(cx + cw, px + pw) - Math.max(cx, px)) * Math.max(0, Math.min(cy + ch, py + ph) - Math.max(cy, py))
    const holdsIt = overlap >= 0.8 * cw * ch && pw * ph > 1.5 * cw * ch
    if (holdsIt && (!best || pw * ph < best.box[2] * best.box[3])) best = p
  }
  return best
}

// Step 2b. A small stroke (an eye, a nose) is placed by where it sits INSIDE the part the user drew around it,
// not on the whole page. A learner who draws the head bigger and lower than the target also draws the eyes lower,
// so on the page they land on the target's nose lines and were counted as head ("Forgot the eyes"). Here each
// parent part (the head) gets its own frame: the box of the user's big strokes for it, stretched onto the box of
// its plan lines. A small stroke given to the parent (or to nothing) whose center, seen in that frame, falls in a
// child part's box (the eyes) goes to that child.
function placeSmallStrokesInsideTheirParent(
  pack: Pack, partSets: Map<string, Point[]>, byStroke: { points: Point[]; part: string | null; distance: number }[],
  targetDiagonal: number,
): Map<string, (p: Point) => Point> {
  const frames = new Map<string, (p: Point) => Point>() // child part id -> its parent's frame (user -> target)
  const smallLimit = config.smallStrokeShare * targetDiagonal
  const isSmall = (points: Point[]) => diagonal(bbox(points)) < smallLimit
  const children = new Map<string, Part[]>() // parent id -> its child parts
  for (const child of pack.parts) {
    const parent = parentOf(child, pack.parts)
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), child])
  }
  for (const [parentId, kids] of children) {
    // Both sides of the frame use only the parent's big lines, so a perfect copy gets an exact (identity) frame.
    const big = byStroke.filter((s) => s.part === parentId && !isSmall(s.points)).flatMap((s) => s.points)
    const bigPlan = pack.strokes
      .filter((s) => s.partId === parentId && s.tier !== 'construction')
      .map((s) => resample(s.points, config.alignPointsPerStroke))
      .filter((points) => !isSmall(points))
      .flat()
    const plan = bigPlan.length > 0 ? bigPlan : partSets.get(parentId) ?? []
    if (big.length === 0 || plan.length === 0) continue
    const [ux, uy, uw, uh] = bbox(big)
    const [tx, ty, tw, th] = bbox(plan)
    if (uw < 1 || uh < 1) continue
    const toTarget = ([x, y]: Point): Point => [tx + ((x - ux) * tw) / uw, ty + ((y - uy) * th) / uh]
    for (const kid of kids) frames.set(kid.id, toTarget)
    // Only strokes inside the user's drawn parent (with a small margin) are candidates.
    const margin = 0.1 * Math.max(uw, uh)
    for (const stroke of byStroke) {
      if (!isSmall(stroke.points) || (stroke.part !== parentId && stroke.part !== null)) continue
      // A stroke lying right on its plan lines (a whisker, a lace) is already placed well: leave it.
      if (stroke.distance <= config.onLineDistance * targetDiagonal) continue
      const [cx, cy] = boxCenter(bbox(stroke.points))
      if (cx < ux - margin || cx > ux + uw + margin || cy < uy - margin || cy > uy + uh + margin) continue
      const [mx, my] = toTarget([cx, cy])
      const kid = kids.find(({ box: [x, y, w, h] }) => mx >= x && mx <= x + w && my >= y && my <= y + h)
      if (kid) stroke.part = kid.id
    }
  }
  return frames
}

// How well a user stroke matches one plan stroke as a shape, plus how far apart they are. The stroke is moved
// onto the plan stroke's center and scaled to its size (within config.rescueScaleRange) before comparing, so a
// handle drawn 30 px to the side and a bit small still matches the handle, and does not match the mug's body.
// shape: symmetric mean distance after that, as a share of the plan stroke's size. offset: distance between
// the two centers, as a share of the drawing's diagonal.
function shapeFit(points: Point[], plan: Point[], targetDiagonal: number): { shape: number; offset: number } {
  const userBox = bbox(points)
  const planBox = bbox(plan)
  const planSize = Math.max(diagonal(planBox), 1)
  const k = clamp(planSize / Math.max(diagonal(userBox), 1), config.rescueScaleRange[0], config.rescueScaleRange[1])
  const [ux, uy] = boxCenter(userBox)
  const [px, py] = boxCenter(planBox)
  const moved = points.map(([x, y]): Point => [px + (x - ux) * k, py + (y - uy) * k])
  return { shape: symmetricChamfer(moved, plan) / planSize, offset: Math.hypot(ux - px, uy - py) / targetDiagonal }
}

// Step 2c. Gives a part that got no strokes back the strokes that are clearly its own. Step 2 hands each stroke
// to the part whose lines are nearest on average, which favours big outlines: a mug handle drawn 30 px out, a
// chimney a little high or a mouth a little low sits nearer the body, roof or chin line than its own, so the
// part got nothing and the user read "Forgot the handle" for a handle they drew (probe: 8 in 30 slightly
// imperfect mugs). Here a stroke moves to a part that has no strokes when it matches one of that part's plan
// strokes as a shape (shapeFit), close by, and clearly better than it matches the part it was given to.
// A stroke can be the only one its part got (a chimney's top line given to the roof, whose own lines went to the
// wall). It still moves when it clearly fits the empty part better, and then the part it left gets its own turn,
// so the passes repeat until nothing moves. Moves only ever go to a clearly better fit, so they can't go back
// and forth.
function rescueMissingParts(
  pack: Pack, byStroke: { points: Point[]; part: string | null; distance: number }[], targetDiagonal: number,
): void {
  const partIds = new Set(pack.parts.map((p) => p.id))
  const visible = pack.strokes.filter((s) => s.tier !== 'construction')
  const plans = new Map<string | null, Point[][]>() // each part's plan lines (null: lines of no part), made once
  const planOf = (partId: string | null) => {
    if (!plans.has(partId)) {
      plans.set(partId, visible
        .filter((s) => (partId === null ? s.partId === null || !partIds.has(s.partId) : s.partId === partId))
        .map((s) => resample(s.points, config.alignPointsPerStroke)))
    }
    return plans.get(partId)!
  }
  // How well a stroke fits a set of plan strokes, among those within the shape and distance limits: score is the
  // best shape + offset (lower is better), shape the closest shape. Both Infinity when none is within the limits.
  const fit = (points: Point[], plan: Point[][]) => {
    let score = Infinity
    let shape = Infinity
    for (const s of plan) {
      const f = shapeFit(points, s, targetDiagonal)
      if (f.shape > config.rescueMaxShape || f.offset > config.rescueMaxOffset) continue
      score = Math.min(score, f.shape + f.offset)
      shape = Math.min(shape, f.shape)
    }
    return { score, shape }
  }
  for (let pass = 0; pass < config.rescuePasses; pass++) {
    let moved = false
    for (const part of pack.parts) {
      if (byStroke.some((b) => b.part === part.id)) continue
      const plan = planOf(part.id)
      if (plan.length === 0) continue
      for (const b of byStroke) {
        if (b.distance === Infinity || b.part === part.id) continue // a heavy scribble measures no part
        const mine = fit(b.points, plan)
        if (mine.score === Infinity) continue
        const current = fit(b.points, planOf(b.part)).score
        // A near tie is not enough: a forgotten pair of ears must not borrow a head stroke that fits them a bit
        // better by chance. A stroke that fits nothing of its own part needs a very close shape (scaled up, a
        // tiny mark looks like any small shape); then how far it was drawn from its place doesn't count against
        // it, within the distance limit (a handle drawn 90 px out, but a perfect handle). A near-exact copy of one
        // of the part's lines only has to fit better: a fish's top fin also looks a bit like a body line.
        const clearly = current === Infinity
          ? mine.shape <= config.rescueAloneMaxShape
          : mine.score <= config.rescueClearWin * current || (mine.shape <= config.rescueExactShape && mine.score < current)
        if (clearly) {
          b.part = part.id
          moved = true
        }
      }
    }
    if (!moved) break
  }
}

// How far a stroke travels compared with the size of its own box, measured on a lightly smoothed copy.
// A scribble goes back and forth over the same area, so it travels many times its size (4x to 28x measured);
// a real line, even a closed loop around a mug, stays under about 3.3x. The smoothing (each point averaged
// with its 2 neighbours on each side, out of 64) takes out small wobble first: a shaky hand adds a lot of
// length to a long outline (a wobbly mug outline measured 4.5x and was thrown out as a scribble), but it
// does not go back and forth like a scribble does.
function travelRatio(stroke: Point[]): number {
  const p = resample(stroke, 64)
  const smooth = p.map((_, i): Point => {
    const window = p.slice(Math.max(0, i - 1), Math.min(p.length, i + 2))
    return [window.reduce((sum, q) => sum + q[0], 0) / window.length, window.reduce((sum, q) => sum + q[1], 0) / window.length]
  })
  return length(smooth) / Math.max(diagonal(bbox(smooth)), 1)
}

// Points every `spacing` px along a line (at least 2), so long lines get more points than short ones and a
// share of points is a share of length.
const evenlySpaced = (points: Point[], spacing: number): Point[] =>
  resample(points, clamp(Math.ceil(length(points) / spacing) + 1, 2, 400))

// The share of the points of `from` (spread evenly along its lines) that have a point of `to` within
// `distance` (of the diagonal). With the reference as `from` it is coverage, "how much of the drawing did you draw":
// unlike the amount of ink, it can't be reached by drawing lots of lines anywhere, or one line many times.
// With the user's lines as `from` it is precision, "how much of what you drew is part of the drawing".
function shareNear(from: Point[][], to: Point[][], targetDiagonal: number, distance: number = config.drawnDistance): number {
  const spacing = Math.max(targetDiagonal / 200, 2)
  const fromPoints = from.flatMap((s) => evenlySpaced(s, spacing))
  const toPoints = to.flatMap((s) => evenlySpaced(s, spacing))
  if (fromPoints.length === 0 || toPoints.length === 0) return 0
  const grid = new PointGrid(toPoints)
  const limit = (distance * targetDiagonal) ** 2
  const near = fromPoints.filter((p) => {
    const q = grid.nearest(p)
    return q !== null && (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= limit
  }).length
  return near / fromPoints.length
}

function missingPart(partId: string, label: string): PartMetric {
  return {
    partId, label, missing: true, sizeError: 0, offset: { dx: 0, dy: 0 }, aspectError: 0, tiltDeg: 0, good: false, userBox: null,
  }
}

export function analyze(fullPack: Pack, strokes: UserStroke[]): Analysis {
  // Only parts that own at least one plan stroke can be measured. A part with no lines of its own (a mug's "rim"
  // whose ellipse was traced into the body outline) could never be drawn, so it was always "Forgot the rim".
  const pack: Pack = { ...fullPack, parts: fullPack.parts.filter((p) => fullPack.strokes.some((s) => s.partId === p.id)) }
  const drawn = strokes.filter((s) => s.points.length >= 2 && !isTap(s.points.map(([x, y]): Point => [x, y])))
  const usedFallback = pack.parts.length === 0
  if (drawn.length === 0) {
    return {
      parts: pack.parts.map((p) => missingPart(p.id, p.label)), shapeSimilarity: 0, lineConfidence: 0,
      overallScale: 1, overallOffset: { dx: 0, dy: 0 }, alignedStrokes: [], usedFallback,
    }
  }

  // 1. Align the whole drawing with the target.
  const target = targetPoints(pack)
  const raw = drawn.map((s) => s.points.map(([x, y]): Point => [x, y]))
  // Scribbles: a stroke that travels much farther than the size of its own box goes back and forth over the same
  // area. Real drawn lines and every plan line stay under about 3.3x; scribbles measured 4x to 28x. Heavy scribbles
  // are ignored like stray marks (a part scribbled in counts as not drawn); lighter ones scale the shape and line
  // scores down by their share of the ink. Before this, zigzags over each part scored up to 84.
  const travel = raw.map(travelRatio)
  const counts = travel.map((t) => t <= config.scribbleDropRatio)
  const lines = raw.filter((_, k) => counts[k])
  const { transform, overallScale, overallOffset } = align(lines.length > 0 ? lines : raw, target)
  const aligned = raw.map((s) => s.map((p) => applyTransform(transform, p)))
  const alignedStrokes: UserStroke[] = drawn.map((s, k) => ({
    points: s.points.map((p, i): TimedPoint => [round2(aligned[k][i][0]), round2(aligned[k][i][1]), p[2], p[3]]),
  }))

  const targetBox = bbox(target)
  const targetDiagonal = diagonal(targetBox) || pack.size
  const userAll = aligned.filter((_, k) => counts[k]).flatMap((s) => resample(s, config.alignPointsPerStroke))
  const height = targetBox[3] || 1

  // 2. Give each stroke to the part whose plan lines it sits closest to. Strokes far from every part are
  // ignored, and so are strokes closest to plan lines that belong to no part.
  const partSets = partPointSets(pack)
  const unlabeled = unlabeledPoints(pack)
  const byStroke = aligned.map((stroke, k) => {
    const points = resample(stroke, config.alignPointsPerStroke)
    if (!counts[k]) return { points, part: null, distance: Infinity } // a heavy scribble measures no part
    let bestPart: string | null = null
    let bestDistance = unlabeled.length > 0 ? meanNearest(points, unlabeled) : Infinity
    for (const [partId, partPoints] of partSets) {
      const d = meanNearest(points, partPoints)
      if (d < bestDistance) {
        bestDistance = d
        bestPart = partId
      }
    }
    return {
      points,
      part: bestPart && bestDistance <= config.partMaxDistance * targetDiagonal ? bestPart : null,
      distance: bestDistance, // how far the stroke is from the plan lines it was given to
    }
  })
  const parentFrames = placeSmallStrokesInsideTheirParent(pack, partSets, byStroke, targetDiagonal)
  rescueMissingParts(pack, byStroke, targetDiagonal)
  const assigned = new Map<string, Point[]>()
  for (const { points, part } of byStroke) {
    if (part) assigned.set(part, [...(assigned.get(part) ?? []), ...points])
  }

  // 3. Measure each part: size, position, width/height ratio and tilt, all in target space. The alignment has
  // already taken out the drawing's overall size and position, so what is left is the part's own error.
  const parts = pack.parts.map((part): PartMetric => {
    const drawnPoints = assigned.get(part.id)
    if (!drawnPoints || drawnPoints.length === 0) return missingPart(part.id, part.label)
    // A part needs some real line of its own to count as drawn: its assigned lines must pass near at least
    // config.partMinCoverage of the part's own plan lines (within config.partCoverDistance, generous, so a part
    // drawn too small or a little out of place still counts). Before this a cat drawn without its tail got the
    // end of the body line next to it as "tail", and was told "Tail 65% too small" instead of "Forgot the tail".
    // (Line length was tried first: real drawings simplify detailed parts, a careful fox had 18% of the legs'
    // plan length, so length marked drawn parts missing.)
    const ownPlan = pack.strokes.filter((s) => s.partId === part.id && s.tier !== 'construction').map((s) => s.points)
    const ownInk = byStroke.flatMap((b, k) => (b.part === part.id ? [aligned[k]] : []))
    if (ownPlan.length > 0 && shareNear(ownPlan, ownInk, targetDiagonal, config.partCoverDistance) < config.partMinCoverage) {
      return missingPart(part.id, part.label)
    }
    const userPoints = drawnPoints
    const isChild = parentFrames.has(part.id) // a part inside another, like the eyes in the head
    const planPoints = partSets.get(part.id) ?? []
    // When the plan lines cover only a little of the part's box (a pack whose left eye was traced into the cheek
    // line has one eye stroke for "eyes"), the part's size can't be judged: only its position is, against the box.
    const [bx0, by0, bw, bh] = part.box
    const covered = bbox(planPoints)[2] * bbox(planPoints)[3] >= config.minPlanCoverage * bw * bh
    const sizeKnown = !isChild || covered
    const tBox = sizeKnown ? bbox(planPoints) : part.box
    const uBox = bbox(userPoints)
    const sizeError = sizeKnown ? diagonal(uBox) / Math.max(diagonal(tBox), 1) - 1 : 0
    const [ux, uy] = boxCenter(uBox)
    const [tx, ty] = boxCenter(tBox)
    const offset = { dx: (ux - tx) / height, dy: (uy - ty) / height }
    const ratio = (b: Box) => Math.max(b[2], 8) / Math.max(b[3], 8) // 8 px floor: a flat line has no ratio
    const aspectError = sizeKnown ? ratio(uBox) / ratio(tBox) - 1 : 0
    const targetAxis = principalAxis(planPoints)
    const tiltDeg = !sizeKnown || targetAxis.elongation < config.roundPartRatio
      ? 0 // a round part (a head circle) has no reliable tilt
      : angleDifference(principalAxis(userPoints).angleDeg, targetAxis.angleDeg)
    const good = Math.max(Math.abs(sizeError), Math.abs(offset.dx), Math.abs(offset.dy), Math.abs(aspectError)) <= config.goodLimit
      && Math.abs(tiltDeg) <= config.goodTiltDeg
    return {
      partId: part.id,
      label: part.label,
      missing: false,
      sizeError: round2(sizeError),
      offset: { dx: round2(offset.dx), dy: round2(offset.dy) },
      aspectError: round2(aspectError),
      tiltDeg: Math.round(tiltDeg),
      good,
      // Position-only parts show the target box moved by the measured offset (their size wasn't judged).
      userBox: (sizeKnown ? inPartBoxFrame(uBox, tBox, part.box) : [bx0 + ux - tx, by0 + uy - ty, bw, bh]).map(Math.round) as Box,
    }
  })

  // 4. Whole-drawing scores. The shape score multiplies four things, each 0-1:
  // - closeness: how far the user's lines are from the drawing's lines on average; config.shapeScale of the
  //   diagonal scores 0. One way only (user to drawing): lines left out are completeness's job, and measuring
  //   them here too (both ways, as before) counted a forgotten part twice, so a neat cat without its head
  //   scored below random lines.
  // - completeness: how much of the drawing was drawn. Missing lines hardly change the mean distance (the
  //   lines left out lie close to lines that were drawn), so without this a copy missing a third of its lines
  //   scored 97. Two measures, and the smaller one counts: the user's line length against the drawing's
  //   (config.completeInk of it counts as complete), and coverage, the share of the drawing's lines that a user
  //   line passes close to (config.completeCoverage counts as complete). Ink alone was fooled by random lines:
  //   14 straight lines across the page have as much ink as a fox.
  // - precision: the share of the user's lines that lie on the drawing's lines (config.completePrecision of it
  //   counts as fully precise). Real copies, even rough ones, measure 0.9 and up; random lines 0.5-0.8.
  // - tidiness: the share of the ink that isn't scribbled.
  // Scribbled ink counts for none of the first three.
  const visiblePlan = pack.strokes.filter((s) => s.tier !== 'construction')
  const planLines = (visiblePlan.length > 0 ? visiblePlan : pack.strokes).map((s) => s.points)
  const drawingLength = planLines.reduce((sum, s) => sum + length(s), 0)
  const tidyLines = aligned.filter((_, k) => travel[k] <= config.scribbleRatio)
  const userLength = tidyLines.reduce((sum, s) => sum + length(s), 0)
  const inkShare = drawingLength > 0 ? clamp(userLength / (config.completeInk * drawingLength), 0, 1) : 1
  const coverShare = clamp(shareNear(planLines, tidyLines, targetDiagonal) / config.completeCoverage, 0, 1)
  const completeness = Math.min(inkShare, coverShare)
  const precision = clamp(shareNear(tidyLines, planLines, targetDiagonal) / config.completePrecision, 0, 1)
  const closeness = userAll.length > 0 ? clamp(1 - meanNearest(userAll, target) / (config.shapeScale * targetDiagonal), 0, 1) : 0
  // The share of the ink that is scribbled (in the user's own scale, so before alignment).
  const allInk = raw.reduce((sum, s) => sum + length(s), 0)
  const scribbled = raw.reduce((sum, s, k) => sum + (travel[k] > config.scribbleRatio ? length(s) : 0), 0)
  const tidy = allInk > 0 ? 1 - scribbled / allInk : 1
  const shapeSimilarity = closeness * completeness * precision * tidy

  return {
    parts: usedFallback ? [] : parts,
    shapeSimilarity: round2(shapeSimilarity),
    lineConfidence: round2(lineConfidence(aligned) * tidy), // aligned, so the 4 px re-stroke distance is in target space
    overallScale: round2(overallScale),
    overallOffset: { dx: round2(overallOffset.dx), dy: round2(overallOffset.dy) },
    alignedStrokes,
    usedFallback,
  }
}
