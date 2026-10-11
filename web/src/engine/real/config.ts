// Every tunable number of the real engine, in one place, so tuning (checkpoint M2) only ever edits this file.
// Distances that say "of the diagonal" are fractions of the target drawing's bounding-box diagonal,
// which makes them work the same for small and large drawings.
export const config = {
  // ---------- stroke matching (match.ts) ----------
  resamplePoints: 64,       // points per stroke when comparing shapes
  guidePoints: 64,          // points per guide when finding which stretch of it a stroke traced
  minStrokeLength: 3,       // px: a stroke shorter than this is a tap, not a line, and is ignored
  accuracyScale: 0.12,      // a Frechet distance of 12% of the diagonal scores 0 accuracy
  matchMaxChamfer: 0.2,     // a stroke farther than this (mean distance, of the diagonal) matches no guide
  doneThreshold: 0.5,       // a stroke at this accuracy or better counts toward drawing its guide
  doneCoverage: 0.8,        // a guide is drawn once strokes like that have covered 80% of it (in one stroke or several)
  minAdaptLength: 20,       // px: shorter traced stretches (dots, ticks) don't move the guides
  coverDistance: 0.035,     // a guide point counts as drawn when a stroke passes this close (of the diagonal),
                            // whichever guide the stroke matched, in whatever direction or however many guides it spans
  stepPatience: 6,          // after this many strokes on one step without finishing it, the lesson moves on
  finishWindow: 2,          // a guide finished by the last 2 strokes can still be matched, so the piece that
                            // finishes a line drawn in several strokes is scored against that line

  // ---------- teacher (teacher.ts) ----------
  adaptMaxRotationDeg: 10,  // guides may turn at most this much to follow the user
  adaptBlend: 0.6,          // after each stroke, move 60% of the way to the newly fitted transform
  adaptMaxPairs: 512,       // keep at most this many matched point pairs (the most recent ones)
  autoWindow: 5,            // auto mode looks at the last 5 matched strokes
  autoFadeAbove: 0.8,       // ...and gives less help when their mean accuracy is above this
  autoHelpBelow: 0.6,       // ...and more help when it is below this
  autoMinStrokesBetween: 3, // at least 3 strokes between two help-level changes
  warnSizeRatio: 0.25,      // warn when a stroke is more than 25% bigger or smaller than its guide

  // ---------- alignment and measurement (align.ts, analyze.ts) ----------
  alignIterations: 30,      // ICP rounds
  alignMaxRotationDeg: 5,   // the whole drawing may turn at most 5 degrees (a tilted head stays a mistake)
  alignScaleRange: [0.4, 2.5] as [number, number], // the fit may scale the drawing by 0.4x to 2.5x, never collapse it
  alignPreferAsDrawn: 0.7,  // the stretched first guess must fit 30% better than "as drawn" to win
  alignPointsPerStroke: 32, // points per stroke during alignment
  partMaxDistance: 0.15,    // strokes farther than 15% of the diagonal from every part are ignored
  smallStrokeShare: 0.12,   // strokes under 12% of the diagonal (eyes, a nose) are placed inside their parent part
  onLineDistance: 0.01,     // a small stroke within 1% of the diagonal of its plan lines is never moved to a child part
  minPlanCoverage: 0.3,     // a child part whose plan lines cover under 30% of its box is judged by position only
  goodLimit: 0.1,           // a part is "good" when every error is within 10%
  goodTiltDeg: 10,          // ...and it is tilted by at most 10 degrees
  roundPartRatio: 1.3,      // parts whose long side is < 1.3x their short side have no reliable tilt
  shapeScale: 0.16,         // mean distance of 16% of the diagonal scores 0 shape similarity (M2: 0.08 was too harsh)
  overstrokeDistance: 4,    // px: a stroke lying within 4 px of an earlier one is a re-stroke
  overstrokeShare: 0.7,     // ...when at least 70% of its points do
  smoothTurnRad: 0.5,       // a median turn of 0.5 rad per sample means a fully shaky line

  // ---------- weaknesses, score, coaching (lesson.ts) ----------
  maxWeaknesses: 3,
  lineWeakBelow: 0.7,       // line confidence under this is reported as a weakness
  proportionTolerance: 0.2, // size and position errors up to 20% cost nothing in the proportion score (M2)
  proportionWorstShare: 0,  // 0 = proportion is the mean over parts; 0.5 = half mean, half the worst part
  weightProportion: 40,     // total = 40 * proportion + 35 * shape + 25 * line
  weightShape: 35,
  weightLine: 25,
  improvedShare: 0.4,       // a fix counts as improved when the retest error is at least 40% smaller
} as const
