# Contract changes

`web/src/engine/types.ts` is the contract that the UI and the engine both build against.
It changes only when both of us agree, and every change gets an entry here, newest first.

## v1 created (2026-10-11)

First version of the contract: `Point`, `TimedPoint`, `Tier`, `Difficulty`, `Box`, `Part`, `PlanStroke`,
`Step`, `PipelineStage`, `Pack`, `SubjectIndex`, `UserStroke`, `Mode`, `HelpLevel`, `Ghost`, `PartMetric`,
`Analysis`, `Weakness`, `ModeChange`, `StrokeResult`, `Teacher`, `Score`, `CoachItem`, `Coaching` and `Engine`.
All coordinates are in a 768 x 768 target space.
