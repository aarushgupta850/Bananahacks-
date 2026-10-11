// The real engine. For now every method hands the call to the mock, so the app works end to end.
// Each method is written out on its own line so it can be swapped for the real version one at a time.
import { mockEngine } from '../mock'
import type { Engine } from '../types'

export const realEngine: Engine = {
  analyze: (pack, strokes) => mockEngine.analyze(pack, strokes),
  findWeaknesses: (pack, analysis) => mockEngine.findWeaknesses(pack, analysis),
  buildLesson: (pack, weaknesses) => mockEngine.buildLesson(pack, weaknesses),
  createTeacher: (pack, steps, mode) => mockEngine.createTeacher(pack, steps, mode),
  score: (analysis) => mockEngine.score(analysis),
  coach: (pack, test, retest) => mockEngine.coach(pack, test, retest),
}
