// Every tunable number of the real engine, in one place, so tuning (checkpoint M2) only ever edits this file.
// Distances that say "of the diagonal" are fractions of the target drawing's bounding-box diagonal,
// which makes them work the same for small and large drawings.
export const config = {
  // ---------- stroke matching (match.ts) ----------
  resamplePoints: 64,       // points per stroke when comparing shapes
  guidePoints: 64,          // points per guide when finding which stretch of it a stroke traced
  minStrokeLength: 3,       // px: a stroke shorter than this is a tap, not a line, and is ignored
  accuracyScale: 0.07,      // a stroke this far off a long guide (of the diagonal; about 60 px on the fox) scores 0.
                            // Was 0.12, which gave 90%+ even to strokes wobbling 10 px off the line.
  accuracyMinScale: 0.03,   // ...a short guide (a toe, an eye) gets less room, down to this (about 25 px)...
  accuracyGuideShare: 0.4,  // ...namely 40% of the guide's own size (its bounding-box diagonal)
  matchMaxChamfer: 0.2,     // a stroke farther than this (mean distance, of the diagonal) matches no guide
  doneThreshold: 0.5,       // a stroke at this accuracy or better counts toward drawing its guide
  doneCoverage: 0.8,        // a guide is drawn once strokes like that have covered 80% of it (in one stroke or several)
  minAdaptLength: 20,       // px: shorter traced stretches (dots, ticks) don't move the guides
  coverDistance: 0.035,     // a guide point counts as drawn when a stroke passes this close (of the diagonal),
                            // whichever guide the stroke matched, in whatever direction or however many guides it spans
  redrawMinAccuracy: 0.7,   // a stroke this close to a line finished earlier (accuracy against it)...
  redrawMaxCurrent: 0.3,    // ...and scoring under this on the guides shown is a redraw of that line, scored against it
  stepPatience: 6,          // after this many strokes in a row near one step that finish none of its guides, the lesson moves on
  finishWindow: 2,          // a guide finished by the last 2 strokes can still be matched, so the piece that
                            // finishes a line drawn in several strokes is scored against that line

  // ---------- teacher (teacher.ts) ----------
  adaptMaxRotationDeg: 0,   // guides never turn: a tilting guide made the whole drawing look off (Oct 13)
  // Calibrate once, then lock (Oct 13, "the pictures move"). The guides may move only during the first 3 strokes
  // that trace a guide, and only within the first 8 strokes of the lesson; after that they never move again, like
  // a printed shadow. A move goes all the way to the fitted place in one go (no creeping 60% at a time), and only
  // when the fit is clearly somewhere else: small differences are hand wobble, and chasing them made the guides
  // and the trace twitch after every stroke.
  adaptCalibrationStrokes: 3, // strokes that traced a guide (matched, long enough, along one guide) may calibrate...
  adaptLastStroke: 5,       // ...and only within 5 strokes of the first stroke that traced a guide (a first move at
                            // stroke 32 after many accepted-or-not fits was a big jump)
  adaptMaxMoves: 2,         // the guides move at most twice in a lesson (usually once, on the first stroke)
  adaptMinMove: 16,         // px: a fit that moves the drawing less than this (at any corner) is wobble: no move.
                            // A natural hand lands each stroke up to about 10 px off, which used to nudge the guides
  adaptMaxResidual: 0.02,   // a stroke whose shape still sits this far from its guide after fitting (mean distance,
                            // of the diagonal) is a badly drawn line, not a shifted drawing: it doesn't calibrate.
                            // Shifted or resized copies fit to under 0.01; one stroke over two guides measured 0.023-0.047
  adaptScaleRange: [0.75, 1.35] as [number, number], // the guides are never resized beyond this
  adaptScaleMinSpan: 0.3,   // until the traced lines span this much of the diagonal, only shift (one small line
                            // says where the user draws, but not how big)...
  adaptMinScaleChange: 0.08, // ...and the size changes only when the fit is at least 8% bigger or smaller: a 5%
                            // "resize" from one line drawn a bit big moved the far side of the drawing 35 px
  adaptLengthRatio: 1.35,   // a stroke within 1.35x of its guide's length (longer or shorter) traced that one guide
  adaptLostStrokes: 2,      // strokes in a row near the guides' original places (and far from the calibrated ones)
                            // before the guides go back there; one stray stroke never moves them
  adaptMaxPairs: 512,       // keep at most this many matched point pairs (the most recent ones)
  autoWindow: 5,            // auto mode looks at the last 5 matched strokes
  autoFadeAbove: 0.8,       // ...and gives less help when their mean accuracy is above this
  autoHelpBelow: 0.6,       // ...and more help when it is below this
  autoMinStrokesBetween: 3, // at least 3 strokes between two help-level changes
  warnSizeRatio: 0.25,      // warn when a stroke is more than 25% bigger or smaller than its guide...
  warnMinGuide: 0.12,       // ...for guides at least this big (of the diagonal); shorter ones give no reliable size

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
  partMinCoverage: 0.2,     // a part whose lines pass near under 20% of its own plan lines counts as missing...
  partCoverDistance: 0.12,  // ...where near is within 12% of the diagonal (generous: a part drawn too small still counts)
  // A part that got no strokes takes back a stroke that matches one of its plan strokes as a shape (analyze.ts
  // rescueMissingParts): the stroke is moved onto the plan stroke and scaled to its size, within this range...
  rescueScaleRange: [0.6, 1.6] as [number, number],
  rescueMaxShape: 0.15,     // ...and then lies within 15% of the plan stroke's size of it, on average...
  rescueMaxOffset: 0.15,    // ...and its center is within 15% of the diagonal of the plan stroke's center
  rescueClearWin: 0.8,      // ...and it fits there at least 20% better than the part it was given to (shape + offset)...
  rescueAloneMaxShape: 0.08, // ...or, when it fits nothing of that part, its shape there is within 8%, anywhere within the distance limit
  rescueExactShape: 0.05,   // a stroke whose shape is within 5% of one of the part's lines only needs to fit better
  rescuePasses: 3,          // a stroke that moves can empty another part, which then gets its turn: at most 3 rounds
  goodLimit: 0.1,           // a part is "good" when every error is within 10%
  goodTiltDeg: 10,          // ...and it is tilted by at most 10 degrees
  roundPartRatio: 1.3,      // parts whose long side is < 1.3x their short side have no reliable tilt
  scribbleRatio: 4,         // a stroke travelling over 4x the size of its own box goes back and forth: a scribble
                            // (real drawn lines and every plan line stay under 3.3x; scribbles measured 4x-28x)...
  scribbleDropRatio: 6,     // ...and over 6x it is ignored like a stray mark (it measures no part)
  completeInk: 0.85,        // drawing at least 85% as much line as the reference counts as complete; less scales
                            // the shape score down (real careful copies draw about 90%, a careless one 28%)
  completeCoverage: 0.8,    // ...and so does passing within drawnDistance of at least 80% of the reference's lines
                            // (a careful real copy covers about 75-80%, half a drawing about 50%, random lines 20-50%)
  completePrecision: 0.85,  // at least 85% of the user's lines lying on the reference's lines counts as fully precise
  drawnDistance: 0.04,      // a reference line point counts as drawn when a user line passes this close (of the diagonal)
  shapeScale: 0.06,         // the user's lines lying 6% of the diagonal from the reference's on average scores 0 closeness.
                            // Was 0.16 (both ways), which gave random lines 0.75; careful real copies measure about 1%
  overstrokeDistance: 4,    // px: a stroke lying within 4 px of an earlier one is a re-stroke
  overstrokeShare: 0.7,     // ...when at least 70% of its points do
  smoothTurnRad: 0.5,       // a median turn of 0.5 rad per sample means a fully shaky line

  // ---------- weaknesses, score, coaching (lesson.ts) ----------
  maxWeaknesses: 3,
  lineWeakBelow: 0.7,       // line confidence under this is reported as a weakness
  proportionTolerance: 0.2, // size and position errors up to 20% cost nothing in the proportion score (M2)
  proportionSlope: 1.5,     // ...beyond that, each 10% of error costs a part 15% of its proportion score
  proportionWorstShare: 0.25, // 0 = proportion is the mean over parts; 0.5 = half mean, half the worst part.
                            // Was 0: with 6 parts a forgotten tail cost only 7 points, and a tailless cat scored 93
  creditFullShape: 0.7,     // proportion and line earn full credit from a shape score of 0.7 up, less below (score())
  weightProportion: 40,     // total = 40 * proportion + 35 * shape + 25 * line
  weightShape: 35,
  weightLine: 25,
  praiseMinShape: 0.5,      // "Already good" part praise only for a retest with at least this shape score
  improvedShare: 0.4,       // a fix counts as improved when the retest error is at least 40% smaller
} as const
