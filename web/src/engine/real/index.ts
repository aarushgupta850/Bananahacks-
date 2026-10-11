// The real engine. Methods that aren't written yet hand the call to the mock, so the app works end to end.
// Each method is written out on its own line so it can be swapped for the real version one at a time.
import { mockEngine } from '../mock'
import { createTeacher } from './teacher'
import type { Engine } from '../types'

export const realEngine: Engine = {
  analyze: (pack, strokes) => mockEngine.analyze(pack, strokes),
  findWeaknesses: (pack, analysis) => mockEngine.findWeaknesses(pack, analysis),
  buildLesson: (pack, weaknesses) => mockEngine.buildLesson(pack, weaknesses),
  createTeacher, // real: adaptive guides and assistance modes (teacher.ts)
  score: (analysis) => mockEngine.score(analysis),
  coach: (pack, test, retest) => mockEngine.coach(pack, test, retest),
}
