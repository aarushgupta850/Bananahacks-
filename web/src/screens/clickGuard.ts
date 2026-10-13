// Every screen's main button (Start test, Done, Start the lesson, Skip to retest...) sits in the same spot, bottom
// right. A double-click or double-tap on one screen's button used to land its second click on the NEXT screen's
// button: "Start test" double-clicked ended the test at once with an empty drawing, and "Go to retest"
// double-tapped submitted an empty retest. So a new screen's main button ignores clicks for a moment after it appears.

// Long enough to cover a double-click (most systems allow up to 500 ms between its clicks), short enough that no
// one reading the screen could press the button sooner.
export const NEXT_GUARD_MS = 500

// True when a click at `now` should count, for a button whose screen appeared at `shownAt` (both performance.now()).
export function clickCounts(shownAt: number, now: number): boolean {
  return now - shownAt >= NEXT_GUARD_MS
}
