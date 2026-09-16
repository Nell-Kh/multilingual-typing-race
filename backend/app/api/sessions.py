import uuid

from fastapi import APIRouter, status
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, SessionDep
from app.core.errors import ApiError
from app.models import TypingSession
from app.schemas.session import KeyStatOut, SessionResult, SessionSubmit
from app.services import sessions, texts

router = APIRouter(prefix="/sessions", tags=["sessions"])


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
    body: SessionSubmit, user: CurrentUser, session: SessionDep
) -> SessionResult:
    text = await texts.get_text(session, body.text_id)
    if text is None or not text.is_active:
        raise ApiError(404, "not_found", "Text not found")
    try:
        row = await sessions.record_practice_session(
            session,
            user_id=user.id,
            text=text,
            started_at=body.started_at,
            raw_keystrokes=body.keystrokes,
        )
    except sessions.SessionRejectedError as exc:
        raise ApiError(422, "invalid_session", str(exc)) from exc
    return _result(row)


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
