import uuid

from fastapi import APIRouter, status
from sqlalchemy.orm import selectinload

from app.core.deps import ClientIp, CurrentUser, RateLimiterDep, SessionDep, SettingsDep
from app.core.errors import ApiError
from app.core.limits import enforce
from app.models import SessionMode, TypingSession
from app.schemas.session import GuestResult, GuestSubmit, KeyStatOut, SessionResult, SessionSubmit
from app.services import sessions, stats, texts

router = APIRouter(prefix="/sessions", tags=["sessions"])

# Scoring a run costs a replay of the whole keystroke log, so the ceiling is
# per account rather than per address (ADR-026).
BUCKET_SUBMIT = "sessions:submit:user"
# A guest has no account, so the address is the only thing to count (ADR-034).
BUCKET_GUEST = "sessions:guest:ip"


def _result(row: TypingSession) -> SessionResult:
    return SessionResult(
        **{k: getattr(row, k) for k in SessionResult.model_fields if k != "key_stats"},
        key_stats=[
            KeyStatOut(
                key=s.key_char,
                correct=s.correct_count,
                errors=s.error_count,
                avg_latency_ms=s.avg_latency_ms,
            )
            for s in sorted(row.key_stats, key=lambda s: s.key_char)
        ],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_session(
    body: SessionSubmit,
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
) -> SessionResult:
    await enforce(
        limiter, settings, BUCKET_SUBMIT, str(user.id), settings.rate_limit_sessions_per_user
    )
    text = await texts.get_text(session, body.text_id)
    if text is None or not text.is_active:
        raise ApiError(404, "not_found", "Text not found")
    if body.mode is SessionMode.DAILY:
        # The daily challenge is one fixed text per day (ADR-019); anything else is practice.
        daily = await stats.daily_text(session, text.language, stats.today())
        if daily is None or daily.id != text.id:
            raise ApiError(422, "not_daily_text", "That text is not today's daily challenge")
    try:
        row = await sessions.record_session(
            session,
            user_id=user.id,
            text=text,
            started_at=body.started_at,
            raw_keystrokes=body.keystrokes,
            mode=body.mode,
        )
    except sessions.SessionRejectedError as exc:
        raise ApiError(422, "invalid_session", str(exc)) from exc
    return _result(row)


@router.post("/guest")
async def score_guest_run(
    body: GuestSubmit,
    ip: ClientIp,
    session: SessionDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
) -> GuestResult:
    """Score a practice run without an account. Same replay, metrics and validator
    as POST /sessions; the difference is that nothing is written — no session row,
    no key stats, so nothing reaches stats or leaderboards (ADR-034)."""
    await enforce(limiter, settings, BUCKET_GUEST, ip, settings.rate_limit_guest_sessions_per_ip)
    text = await texts.get_text(session, body.text_id)
    if text is None or not text.is_active:
        raise ApiError(404, "not_found", "Text not found")
    try:
        run = sessions.score_run(
            text=text, started_at=body.started_at, raw_keystrokes=body.keystrokes
        )
    except sessions.SessionRejectedError as exc:
        raise ApiError(422, "invalid_session", str(exc)) from exc
    m = run.metrics
    return GuestResult(
        text_id=text.id,
        language=text.language,
        duration_ms=run.duration_ms,
        wpm=m.wpm,
        cpm=m.cpm,
        raw_wpm=m.raw_wpm,
        accuracy=m.accuracy,
        error_count=m.error_count,
        keystroke_count=m.keystroke_count,
        is_valid=run.verdict.valid,
        invalid_reason=run.invalid_reason,
        key_stats=[
            KeyStatOut(
                key=key,
                correct=stat.correct,
                errors=stat.errors,
                avg_latency_ms=stat.avg_latency_ms,
            )
            for key, stat in sorted(m.per_key.items())
        ],
    )


@router.get("/{session_id}")
async def get_session(
    session_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> SessionResult:
    row = await session.get(
        TypingSession, session_id, options=[selectinload(TypingSession.key_stats)]
    )
    if row is None or row.user_id != user.id:
        raise ApiError(404, "not_found", "Session not found")
    return _result(row)
