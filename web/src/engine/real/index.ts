// The real engine: pure TypeScript, no DOM, no dependencies. Tunable numbers live in config.ts.
// - analyze.ts: aligns a solo drawing with the target and measures every part
// - lesson.ts: weak spots, lesson order, score and before/after coaching
// - teacher.ts: the live lesson (stroke matching, adaptive guides, assistance modes)
import type { Engine } from '../types'
import { analyze } from './analyze'
import { buildLesson, coach, findWeaknesses, score } from './lesson'
import { createTeacher } from './teacher'

export const realEngine: Engine = { analyze, findWeaknesses, buildLesson, createTeacher, score, coach }
