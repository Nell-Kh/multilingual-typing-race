"""Personal stats: /me/stats, /me/sessions, /me/keys (ADR-019)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, SessionDep
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Cursor, decode_cursor
from app.models import Language
from app.schemas.session import SessionOut
from app.schemas.stats import (
    KeyAggregateOut,
    KeysOut,
    LanguageStatsOut,
    SessionPage,
    StatsOut,
    TrendPointOut,
)
from app.services import stats

router = APIRouter(prefix="/me", tags=["stats"])


@router.get("/stats")
async def my_stats(user: CurrentUser, session: SessionDep) -> StatsOut:
    languages = await stats.user_stats(session, user.id)
    trend = await stats.user_trend(session, user.id)
    return StatsOut(
        languages=[LanguageStatsOut(**s.__dict__) for s in languages],
        trend=[TrendPointOut(**t.__dict__) for t in trend],
    )


@router.get("/sessions")
async def my_sessions(
    user: CurrentUser,
    session: SessionDep,
    lang: Language | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> SessionPage:
    rows = await stats.user_sessions(
        session, user.id, language=lang, limit=limit, after=decode_cursor(cursor)
    )
    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = Cursor(created_at=last.created_at, id=last.id).encode()
    return SessionPage(items=[SessionOut.model_validate(r) for r in rows], next_cursor=next_cursor)


@router.get("/keys")
async def my_keys(user: CurrentUser, session: SessionDep, lang: Language) -> KeysOut:
    keys = await stats.user_keys(session, user.id, language=lang)
    return KeysOut(
        language=lang,
        keys=[
            KeyAggregateOut(
                key=k.key,
                correct=k.correct,
                errors=k.errors,
                error_rate=k.error_rate,
                avg_latency_ms=k.avg_latency_ms,
            )
            for k in keys
        ],
    )
