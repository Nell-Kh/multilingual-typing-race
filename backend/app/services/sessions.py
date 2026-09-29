"""Turn a submitted keystroke log into a validated typing session: scored for
everyone, stored only for an account (ADR-034)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SessionKeyStat, SessionMode, Text, TypingSession
from app.services import typing_metrics, validator
from app.services.typing_metrics import Keystroke

# A practice session may not have started more than this long ago. Blocks
# replaying an old log with a fresh `started_at`.
MAX_SESSION_AGE = timedelta(hours=2)


class SessionRejectedError(Exception):
    """Malformed input — as opposed to a valid submission that fails anti-cheat,
    which is stored with is_valid=False and is not an error."""


def _client_duration_ms(keystrokes: list[Keystroke]) -> int:
    return keystrokes[-1][0]


@dataclass(frozen=True)
class ScoredRun:
    """Everything the server decides about one log, before anything is stored."""

    keystrokes: list[Keystroke]
    duration_ms: int
    metrics: typing_metrics.Metrics
    verdict: validator.Verdict

    @property
    def invalid_reason(self) -> str | None:
        return self.verdict.reason or (
            "flagged_for_review" if self.verdict.flagged_for_review else None
        )


def score_run(
    *,
    text: Text,
    started_at: datetime,
    raw_keystrokes: list[list[object]],
    server_duration_ms: int | None = None,
    now: datetime | None = None,
) -> ScoredRun:
    """Replay, measure and validate a log. Pure: no database, so a guest run and an
    account's run are judged by exactly the same code (ADR-034)."""
    now = now or datetime.now(UTC)
    if started_at > now + timedelta(seconds=30):
        raise SessionRejectedError("started_at is in the future")
    if now - started_at > MAX_SESSION_AGE:
        raise SessionRejectedError("session started too long ago")

    try:
        keystrokes = typing_metrics.parse_keystrokes(raw_keystrokes)
    except ValueError as exc:
        raise SessionRejectedError(str(exc)) from exc

    duration_ms = _client_duration_ms(keystrokes)
    if duration_ms <= 0:
        raise SessionRejectedError("last keystroke must be after the start")

    metrics = typing_metrics.compute(keystrokes, duration_ms)
    verdict = validator.validate(
        keystrokes,
        text.content_normalized,
        wpm=metrics.wpm,
        client_duration_ms=duration_ms,
        server_duration_ms=server_duration_ms,
    )
    return ScoredRun(keystrokes, duration_ms, metrics, verdict)


async def record_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    text: Text,
    started_at: datetime,
    raw_keystrokes: list[list[object]],
    mode: SessionMode = SessionMode.PRACTICE,
    race_id: uuid.UUID | None = None,
    server_duration_ms: int | None = None,
    now: datetime | None = None,
) -> TypingSession:
    """Score and validate one keystroke log and store it. Practice and race runs
    share everything except `mode`, the race link, and the extra server-clock
    check races get (docs/race-protocol.md §5)."""
    run = score_run(
        text=text,
        started_at=started_at,
        raw_keystrokes=raw_keystrokes,
        server_duration_ms=server_duration_ms,
        now=now,
    )
    keystrokes, duration_ms, metrics, verdict = (
        run.keystrokes,
        run.duration_ms,
        run.metrics,
        run.verdict,
    )

    row = TypingSession(
        user_id=user_id,
        text_id=text.id,
        mode=mode,
        race_id=race_id,
        language=text.language,
        started_at=started_at,
        finished_at=started_at + timedelta(milliseconds=duration_ms),
        duration_ms=duration_ms,
        wpm=metrics.wpm,
        cpm=metrics.cpm,
        raw_wpm=metrics.raw_wpm,
        accuracy=metrics.accuracy,
        error_count=metrics.error_count,
        keystroke_count=metrics.keystroke_count,
        is_valid=verdict.valid,
        invalid_reason=run.invalid_reason,
        keystrokes=[list(k) for k in keystrokes],
        key_stats=[
            SessionKeyStat(
                key_char=key,
                correct_count=stat.correct,
                error_count=stat.errors,
                avg_latency_ms=stat.avg_latency_ms,
            )
            for key, stat in metrics.per_key.items()
        ],
    )
    session.add(row)
    await session.commit()
    await session.refresh(row, attribute_names=["key_stats"])
    return row


async def record_practice_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    text: Text,
    started_at: datetime,
    raw_keystrokes: list[list[object]],
    now: datetime | None = None,
) -> TypingSession:
    return await record_session(
        session,
        user_id=user_id,
        text=text,
        started_at=started_at,
        raw_keystrokes=raw_keystrokes,
        now=now,
    )


async def get_session(session: AsyncSession, session_id: uuid.UUID) -> TypingSession | None:
    return await session.get(TypingSession, session_id)
