"""Pydantic models that mirror web/src/engine/types.ts exactly, so the pack builder can't write a pack.json
the web app would reject. Field names match the TypeScript ones (camelCase), and unknown fields are errors.

The same cross-checks as web/src/lib/packs.ts (parsePack) are applied too: a stroke's partId must name a
real part, and a step's strokeIds must name real strokes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Tier = Literal["construction", "outline", "structure", "detail"]
Difficulty = Literal["simple", "medium", "detailed"]
StageId = Literal["source", "candidates", "chosen", "skeleton", "parts", "order"]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]  # [x, y] in 768 x 768 space
Box = Annotated[list[float], Field(min_length=4, max_length=4)]  # [x, y, w, h]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Part(Strict):
    id: str
    label: str
    box: Box


class PlanStroke(Strict):
    id: str
    points: list[Point]
    tier: Tier
    partId: str | None  # required, but may be null
    keyPoints: list[Point]


class Step(Strict):
    id: str
    label: str
    tip: str
    tier: Tier
    strokeIds: list[str]


class PipelineStage(Strict):
    id: StageId
    label: str
    # Optional in types.ts: leave them out of the JSON rather than writing null.
    text: str | None = None
    image: str | None = None
    images: list[str] | None = None


class Source(Strict):
    kind: Literal["prompt", "photo"]
    prompt: str | None = None


class Pack(Strict):
    id: str
    subject: str
    title: str
    difficulty: Difficulty
    size: Literal[768]
    source: Source
    target: str
    thumb: str
    parts: list[Part]
    strokes: list[PlanStroke]
    steps: list[Step]
    pipeline: list[PipelineStage]

    @model_validator(mode="after")
    def references_exist(self) -> "Pack":
        part_ids = {p.id for p in self.parts}
        stroke_ids = {s.id for s in self.strokes}
        for s in self.strokes:
            if s.partId is not None and s.partId not in part_ids:
                raise ValueError(f"stroke {s.id} refers to a part that doesn't exist ({s.partId})")
        for step in self.steps:
            for stroke_id in step.strokeIds:
                if stroke_id not in stroke_ids:
                    raise ValueError(f"step {step.id} refers to a stroke that doesn't exist ({stroke_id})")
        return self


class SubjectEntry(Strict):
    subject: str
    title: str
    thumb: str  # relative to /subjects/
    packs: dict[Difficulty, str]  # difficulty -> pack folder id, e.g. {"medium": "fox-medium"}


class SubjectIndex(Strict):
    subjects: list[SubjectEntry]
