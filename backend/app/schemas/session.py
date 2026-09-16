import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Language, SessionMode

MAX_KEYSTROKES = 20_000  # 2000-char text with generous corrections; bounds request size


class SessionSubmit(BaseModel):
    """What the client sends when a practice run ends. Only the log; no numbers."""

    text_id: uuid.UUID
    mode: Literal[SessionMode.PRACTICE] = SessionMode.PRACTICE
    started_at: datetime
    keystrokes: list[list[object]] = Field(min_length=1, max_length=MAX_KEYSTROKES)


class KeyStatOut(BaseModel):
    key: str
    correct: int
    errors: int
    avg_latency_ms: float | None


class SessionOut(BaseModel):
    """What the server decided. Every number here was computed from the log."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text_id: uuid.UUID
    mode: SessionMode
    language: Language
    started_at: datetime
    finished_at: datetime
    duration_ms: int
    wpm: float
    cpm: float
    raw_wpm: float
    accuracy: float
    error_count: int
    keystroke_count: int
    is_valid: bool
    invalid_reason: str | None
    created_at: datetime


class SessionResult(SessionOut):
    """Returned on submit: the row plus the per-key breakdown for the results screen."""

    key_stats: list[KeyStatOut]
