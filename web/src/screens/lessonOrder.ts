// Shared by the lesson animation and its legend: tier names and the order the lesson draws the strokes in.
import type { Pack, PlanStroke, Tier } from '../engine/types'

export const TIER_NAMES: Record<Tier, string> = {
  construction: 'Construction', outline: 'Outlines', structure: 'Structure', detail: 'Details',
}
export const TIER_ORDER: Tier[] = ['construction', 'outline', 'structure', 'detail']

// Strokes in the order the lesson draws them: step by step, then any strokes no step uses.
export function lessonOrder(pack: Pack): PlanStroke[] {
  const byId = new Map(pack.strokes.map((s) => [s.id, s]))
  const ordered = pack.steps.flatMap((step) => step.strokeIds).map((id) => byId.get(id))
    .filter((s): s is PlanStroke => s !== undefined)
  const seen = new Set(ordered.map((s) => s.id))
  return [...new Set([...ordered, ...pack.strokes.filter((s) => !seen.has(s.id))])]
}
