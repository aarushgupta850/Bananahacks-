// Ghost Lines shared contract. All coordinates are in a 768 x 768 target space.
// Both the UI and the engine build against this file. Never change it without both of us agreeing,
// and log every change in CONTRACT_CHANGES.md at the repo root.
export type Point = [number, number];
export type TimedPoint = [number, number, number, number]; // x, y, pressure 0-1, ms since stroke start
export type Tier = 'construction' | 'outline' | 'structure' | 'detail';
export type Difficulty = 'simple' | 'medium' | 'detailed';
export type Box = [number, number, number, number]; // x, y, w, h

export interface Part { id: string; label: string; box: Box; }
export interface PlanStroke { id: string; points: Point[]; tier: Tier; partId: string | null; keyPoints: Point[]; }
export interface Step { id: string; label: string; tip: string; tier: Tier; strokeIds: string[]; }
export interface PipelineStage {
  id: 'source' | 'candidates' | 'chosen' | 'skeleton' | 'parts' | 'order';
  label: string; text?: string; image?: string; images?: string[];
}
export interface Pack {
  id: string; subject: string; title: string; difficulty: Difficulty; size: 768;
  source: { kind: 'prompt' | 'photo'; prompt?: string };
  target: string; thumb: string; // relative to the pack folder, or an absolute/data: URL for live packs
  parts: Part[]; strokes: PlanStroke[]; steps: Step[]; pipeline: PipelineStage[];
}
export interface SubjectIndex {
  subjects: { subject: string; title: string; thumb: string; packs: Partial<Record<Difficulty, string>> }[];
} // packs maps difficulty -> pack folder id (e.g. "fox-medium"); thumb is relative to /subjects/

export interface UserStroke { points: TimedPoint[]; }
// Mode is what the user picks; HelpLevel is what the teacher is actually showing right now.
// In 'auto' mode the teacher moves between the three help levels by itself.
export type Mode = 'guided' | 'hints' | 'checkin' | 'auto';
export type HelpLevel = 'guided' | 'hints' | 'checkin';
// Ghost kinds: 'stroke' = a full guide line, 'keypoints' = dots to connect, 'construction' = a construction shape.
export interface Ghost { strokeId: string; kind: 'stroke' | 'keypoints' | 'construction'; points: Point[]; }

export interface PartMetric {
  partId: string; label: string; missing: boolean;
  sizeError: number;                  // +0.24 = 24% too big, -0.10 = 10% too small
  offset: { dx: number; dy: number }; // fraction of drawing height; +dy = too low, +dx = too far right
  aspectError: number;                // relative error of width/height ratio
  tiltDeg: number;                    // user tilt minus target tilt
  good: boolean;                      // all errors within 10%
  userBox: Box | null;                // aligned, in target space
}
export interface Analysis {
  parts: PartMetric[];
  shapeSimilarity: number;            // 0-1
  lineConfidence: number;             // 0-1
  overallScale: number;               // 0.7 = drew 30% smaller (not penalized)
  overallOffset: { dx: number; dy: number };
  alignedStrokes: UserStroke[];
  usedFallback: boolean;              // true if the pack had no parts
}
export interface Weakness {
  partId: string | null; kind: 'size' | 'position' | 'shape' | 'missing' | 'line';
  severity: number; message: string;
}
export interface ModeChange { atStroke: number; from: HelpLevel; to: HelpLevel; }
export interface StrokeResult {
  accuracy: number | null;            // null if the stroke matched no guide
  completedStepIds: string[];
  currentStepId: string | null;
  ghosts: Ghost[];                    // what to show now, already adapted to the user's drawing
  helpLevel: HelpLevel;
  warning?: string;
  done: boolean;
}
export interface Teacher {
  addStroke(stroke: UserStroke): StrokeResult; // must return in under 50 ms
  setMode(mode: Mode): StrokeResult;
  showMe(): Ghost[];
  state(): StrokeResult;
  history(): ModeChange[];
}
export interface Score { total: number; proportion: number; shape: number; line: number; } // total 0-100, others 0-1
export interface CoachItem { text: string; partId: string | null; status: 'improved' | 'not-yet' | 'good'; }
export interface Coaching { fix: CoachItem[]; good: CoachItem[]; }
export interface Engine {
  analyze(pack: Pack, strokes: UserStroke[]): Analysis;
  findWeaknesses(pack: Pack, analysis: Analysis): Weakness[];
  buildLesson(pack: Pack, weaknesses: Weakness[]): Step[];
  createTeacher(pack: Pack, steps: Step[], mode: Mode): Teacher;
  score(analysis: Analysis): Score;
  coach(pack: Pack, test: Analysis, retest: Analysis): Coaching;
}
