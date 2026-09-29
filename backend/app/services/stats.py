"""Stats, leaderboards and the daily challenge (ADR-019).

Everything here is a read over `typing_sessions`, and everything only counts
`is_valid` rows: a rejected log is stored for inspection but never scores.
"""

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Float, Integer, cast, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import Cursor
from app.models import Language, SessionKeyStat, SessionMode, Text, TypingSession, User
from app.services.typing_metrics import BACKSPACE

Period = Literal["day", "week", "all"]
# How a tie is numbered: "standard" leaves a gap after it (1, 2, 2, 4),
# "dense" does not (1, 2, 2, 3). See ADR-025.
Ranking = Literal["standard", "dense"]
RECENT_FOR_AVERAGES = 20
TREND_POINTS = 30
LEADERBOARD_LIMIT = 50

# The app's calendar (ADR-030). The daily challenge turns over, and the "day" and
# "week" boards start, at midnight here — not at midnight UTC, which is 02:00 or
# 03:00 for the players this app is for. ZoneInfo follows daylight saving, so the
# boundary is local midnight all year; a fixed +02:00 would be an hour off every
# summer. Israel changes the clocks at 02:00, so local midnight always exists.
APP_TZ = ZoneInfo("Asia/Jerusalem")


# ---- personal stats -------------------------------------------------------------------


@dataclass(frozen=True)
class LanguageStats:
    language: Language
    runs: int
    best_wpm: float
    avg_wpm: float  # over the most recent RECENT_FOR_AVERAGES valid runs
    avg_accuracy: float  # same window
    total_time_ms: int


@dataclass(frozen=True)
class TrendPoint:
    started_at: datetime
    language: Language
    mode: SessionMode
    wpm: float
    accuracy: float


async def user_stats(session: AsyncSession, user_id: uuid.UUID) -> list[LanguageStats]:
    valid = (TypingSession.user_id == user_id, TypingSession.is_valid.is_(True))
    totals = (
        await session.execute(
            select(
                TypingSession.language,
                func.count(),
                func.max(TypingSession.wpm),
                func.sum(TypingSession.duration_ms),
            )
            .where(*valid)
            .group_by(TypingSession.language)
        )
    ).all()
    result = []
    for language, runs, best, total_ms in totals:
        # Averages over the recent window, so old slow runs stop dragging the number down.
        recent = (
            await session.execute(
                select(TypingSession.wpm, TypingSession.accuracy)
                .where(*valid, TypingSession.language == language)
                .order_by(TypingSession.started_at.desc())
                .limit(RECENT_FOR_AVERAGES)
            )
        ).all()
        result.append(
            LanguageStats(
                language=language,
                runs=int(runs),
                best_wpm=round(float(best), 2),
                avg_wpm=round(sum(r.wpm for r in recent) / len(recent), 2),
                avg_accuracy=round(sum(r.accuracy for r in recent) / len(recent), 2),
                total_time_ms=int(total_ms),
            )
        )
    return sorted(result, key=lambda s: s.language.value)


async def user_trend(session: AsyncSession, user_id: uuid.UUID) -> list[TrendPoint]:
    """The last TREND_POINTS valid runs, oldest first, for a line chart."""
    rows = (
        await session.execute(
            select(
                TypingSession.started_at,
                TypingSession.language,
                TypingSession.mode,
                TypingSession.wpm,
                TypingSession.accuracy,
            )
            .where(TypingSession.user_id == user_id, TypingSession.is_valid.is_(True))
            .order_by(TypingSession.started_at.desc())
            .limit(TREND_POINTS)
        )
    ).all()
    return [TrendPoint(*row) for row in reversed(rows)]


async def user_sessions(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    language: Language | None,
    limit: int,
    after: Cursor | None,
) -> Sequence[TypingSession]:
    """History, newest first, keyset-paginated like every other list (ADR-011)."""
    stmt = select(TypingSession).where(TypingSession.user_id == user_id)
    if language is not None:
        stmt = stmt.where(TypingSession.language == language)
    if after is not None:
        stmt = stmt.where(
            tuple_(TypingSession.created_at, TypingSession.id) < (after.created_at, after.id)
        )
    stmt = stmt.order_by(TypingSession.created_at.desc(), TypingSession.id.desc()).limit(limit)
    return (await session.scalars(stmt)).all()


@dataclass(frozen=True)
class KeyAggregate:
    key: str
    correct: int
    errors: int
    avg_latency_ms: float | None

    @property
    def error_rate(self) -> float:
        total = self.correct + self.errors
        return round(self.errors / total, 4) if total else 0.0


async def user_keys(
    session: AsyncSession, user_id: uuid.UUID, *, language: Language
) -> list[KeyAggregate]:
    """Per-key totals across all valid runs in one language: what the heatmap colours."""
    weighted = func.sum(SessionKeyStat.avg_latency_ms * SessionKeyStat.correct_count)
    weights = func.sum(SessionKeyStat.correct_count)
    rows = (
        await session.execute(
            select(
                SessionKeyStat.key_char,
                cast(func.sum(SessionKeyStat.correct_count), Integer),
                cast(func.sum(SessionKeyStat.error_count), Integer),
                cast(weighted / func.nullif(weights, 0), Float),
            )
            .join(TypingSession, TypingSession.id == SessionKeyStat.session_id)
            .where(
                TypingSession.user_id == user_id,
                TypingSession.is_valid.is_(True),
                TypingSession.language == language,
            )
            .group_by(SessionKeyStat.key_char)
        )
    ).all()
    return sorted(
        (
            KeyAggregate(
                key=key,
                correct=int(correct),
                errors=int(errors),
                avg_latency_ms=round(float(latency), 1) if latency is not None else None,
            )
            for key, correct, errors, latency in rows
        ),
        key=lambda k: (-k.error_rate, k.key),
    )


# ---- leaderboards --------------------------------------------------------------------------


@dataclass(frozen=True)
class LeaderboardRow:
    rank: int
    user_id: uuid.UUID
    display_name: str
    wpm: float
    accuracy: float
    started_at: datetime


def period_start(period: Period, now: datetime | None = None) -> datetime | None:
    """Local midnight today / on Monday in APP_TZ; None means no lower bound."""
    local = (now or datetime.now(UTC)).astimezone(APP_TZ)
    if period == "day":
        return local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        monday = local - timedelta(days=local.weekday())
        return monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return None


async def leaderboard(
    session: AsyncSession,
    *,
    language: Language,
    period: Period,
    limit: int | None = LEADERBOARD_LIMIT,
    mode: SessionMode | None = None,
    text_id: uuid.UUID | None = None,
    ranking: Ranking = "standard",
    now: datetime | None = None,
) -> list[LeaderboardRow]:
    """Each user's single best valid run in the window, ranked by WPM.

    The rank comes from the database, not from the row's position (ADR-025): two
    players with the same WPM are the same rank, and the number a player is shown
    does not change with how much of the board was fetched.
    """
    conditions = [TypingSession.language == language, TypingSession.is_valid.is_(True)]
    since = period_start(period, now)
    if since is not None:
        conditions.append(TypingSession.started_at >= since)
    if mode is not None:
        conditions.append(TypingSession.mode == mode)
    if text_id is not None:
        conditions.append(TypingSession.text_id == text_id)

    # DISTINCT ON keeps one row per user: the fastest, earliest on ties.
    best = (
        select(TypingSession)
        .where(*conditions)
        .distinct(TypingSession.user_id)
        .order_by(
            TypingSession.user_id,
            TypingSession.wpm.desc(),
            TypingSession.started_at.asc(),
        )
        .subquery()
    )
    # rank() leaves a gap after a tie (1, 2, 2, 4); dense_rank() does not (1, 2, 2, 3).
    rank_fn = func.dense_rank() if ranking == "dense" else func.rank()
    ranked = (
        select(
            best.c.user_id,
            User.display_name,
            best.c.wpm,
            best.c.accuracy,
            best.c.started_at,
            rank_fn.over(order_by=best.c.wpm.desc()).label("rank"),
        )
        .join(User, User.id == best.c.user_id)
        .subquery()
    )
    rows = (
        await session.execute(
            # Ties share a rank, so the earlier run is listed first within one.
            select(ranked).order_by(ranked.c.rank.asc(), ranked.c.started_at.asc()).limit(limit)
        )
    ).all()  # limit=None means the whole board
    return [
        LeaderboardRow(
            rank=int(rank),
            user_id=user_id,
            display_name=name,
            wpm=wpm,
            accuracy=accuracy,
            started_at=started_at,
        )
        for user_id, name, wpm, accuracy, started_at, rank in rows
    ]


# ---- daily challenge ------------------------------------------------------------------------


def daily_index(day: date, language: Language, count: int) -> int:
    """A stable pick for (day, language): every replica computes the same text with no
    shared state (ADR-019)."""
    digest = hashlib.sha256(f"{day.isoformat()}:{language.value}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % count


async def daily_text(session: AsyncSession, language: Language, day: date) -> Text | None:
    ids = (
        await session.scalars(
            select(Text.id)
            .where(Text.language == language, Text.is_active.is_(True))
            .order_by(Text.id)
        )
    ).all()
    if not ids:
        return None
    return await session.get(Text, ids[daily_index(day, language, len(ids))])


def today(now: datetime | None = None) -> date:
    """The date the daily challenge belongs to: the calendar date in APP_TZ."""
    return (now or datetime.now(UTC)).astimezone(APP_TZ).date()


# ---- the daily ghost (ADR-035) ---------------------------------------------------------------


@dataclass(frozen=True)
class Ghost:
    """Today's #1 on the daily board, as much of their run as a ghost bar needs."""

    display_name: str
    wpm: float
    offsets_ms: list[int]


def progress_offsets(keystrokes: Sequence[Sequence[object]]) -> list[int]:
    """For each character of the finished text, when it was typed for the last time,
    in ms from the run's first key. Replaying the log is enough: a character is
    appended, a backspace takes the last one away, and what is left is the text
    (the validator checked that), so the times left are one per character and in
    order. Wrong keys and corrections cancel out; no character leaves this function."""
    if not keystrokes:
        return []
    t0 = int(str(keystrokes[0][0]))
    times: list[int] = []
    for t, _expected, typed in keystrokes:
        if typed == BACKSPACE:
            if times:
                times.pop()
        else:
            times.append(int(str(t)) - t0)
    return times


async def daily_ghost(
    session: AsyncSession, *, language: Language, text_id: uuid.UUID, now: datetime | None = None
) -> Ghost | None:
    """The run in first place on today's daily board: the fastest valid daily run on
    today's text, earliest on ties, which is exactly the board's row #1."""
    since = period_start("day", now)
    conditions = [
        TypingSession.language == language,
        TypingSession.is_valid.is_(True),
        TypingSession.mode == SessionMode.DAILY,
        TypingSession.text_id == text_id,
    ]
    if since is not None:
        conditions.append(TypingSession.started_at >= since)
    row = (
        await session.execute(
            select(TypingSession.keystrokes, TypingSession.wpm, User.display_name)
            .join(User, User.id == TypingSession.user_id)
            .where(*conditions)
            .order_by(TypingSession.wpm.desc(), TypingSession.started_at.asc())
            .limit(1)
        )
    ).first()
    if row is None or not row.keystrokes:
        return None
    return Ghost(
        display_name=row.display_name, wpm=row.wpm, offsets_ms=progress_offsets(row.keystrokes)
    )
