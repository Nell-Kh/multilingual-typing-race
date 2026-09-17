"""Leaderboards and the daily challenge (ADR-019)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials

from app.core.deps import SessionDep, optional_bearer
from app.core.errors import ApiError
from app.core.security import InvalidTokenError, TokenType, decode_token
from app.models import Language, SessionMode, User
from app.schemas.stats import DailyOut, LeaderboardOut, LeaderboardRowOut
from app.schemas.text import TextOut
from app.services import stats, users
from app.services.stats import Period

router = APIRouter(tags=["leaderboards"])

OptionalCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(optional_bearer)]


async def _viewer(session: SessionDep, credentials: OptionalCredentials) -> User | None:
    """Leaderboards are public; a logged-in viewer additionally gets their own row."""
    if credentials is None:
        return None
    try:
        claims = decode_token(credentials.credentials, TokenType.ACCESS)
    except InvalidTokenError:
        return None
    return await users.get_user(session, claims.sub)


async def _board(
    session: SessionDep,
    *,
    language: Language,
    period: Period,
    viewer: User | None,
    mode: SessionMode | None = None,
    text_id: uuid.UUID | None = None,
) -> LeaderboardOut:
    rows = await stats.leaderboard(
        session, language=language, period=period, mode=mode, text_id=text_id
    )
    me = None
    if viewer is not None:
        mine = next((r for r in rows if r.user_id == viewer.id), None)
        if mine is None:
            # Not in the top N: rank them against the whole board.
            everyone = await stats.leaderboard(
                session, language=language, period=period, mode=mode, text_id=text_id, limit=None
            )
            mine = next((r for r in everyone if r.user_id == viewer.id), None)
        me = LeaderboardRowOut(**mine.__dict__) if mine else None
    return LeaderboardOut(
        language=language,
        period=period,
        rows=[LeaderboardRowOut(**r.__dict__) for r in rows],
        me=me,
    )


@router.get("/leaderboards")
async def get_leaderboard(
    session: SessionDep,
    credentials: OptionalCredentials,
    lang: Language,
    period: Annotated[Period, Query()] = "all",
) -> LeaderboardOut:
    viewer = await _viewer(session, credentials)
    return await _board(session, language=lang, period=period, viewer=viewer)


@router.get("/daily")
async def get_daily(session: SessionDep, lang: Language) -> DailyOut:
    day = stats.today()
    text = await stats.daily_text(session, lang, day)
    if text is None:
        raise ApiError(404, "not_found", "No text available for that language")
    return DailyOut(day=day, language=lang, text=TextOut.model_validate(text))


@router.get("/daily/leaderboard")
async def get_daily_leaderboard(
    session: SessionDep, credentials: OptionalCredentials, lang: Language
) -> LeaderboardOut:
    text = await stats.daily_text(session, lang, stats.today())
    if text is None:
        raise ApiError(404, "not_found", "No text available for that language")
    viewer = await _viewer(session, credentials)
    return await _board(
        session,
        language=lang,
        period="day",
        viewer=viewer,
        mode=SessionMode.DAILY,
        text_id=text.id,
    )
