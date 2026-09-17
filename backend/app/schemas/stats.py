import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.models.enums import Language, SessionMode
from app.schemas.session import SessionOut
from app.schemas.text import TextOut


class LanguageStatsOut(BaseModel):
    language: Language
    runs: int
    best_wpm: float
    avg_wpm: float
    avg_accuracy: float
    total_time_ms: int


class TrendPointOut(BaseModel):
    started_at: datetime
    language: Language
    mode: SessionMode
    wpm: float
    accuracy: float


class StatsOut(BaseModel):
    languages: list[LanguageStatsOut]
    trend: list[TrendPointOut]


class SessionPage(BaseModel):
    items: list[SessionOut]
    next_cursor: str | None


class KeyAggregateOut(BaseModel):
    key: str
    correct: int
    errors: int
    error_rate: float
    avg_latency_ms: float | None


class KeysOut(BaseModel):
    language: Language
    keys: list[KeyAggregateOut]


class LeaderboardRowOut(BaseModel):
    rank: int
    user_id: uuid.UUID
    display_name: str
    wpm: float
    accuracy: float
    started_at: datetime


class LeaderboardOut(BaseModel):
    language: Language
    period: str
    rows: list[LeaderboardRowOut]
    me: LeaderboardRowOut | None


class DailyOut(BaseModel):
    day: date
    language: Language
    text: TextOut
