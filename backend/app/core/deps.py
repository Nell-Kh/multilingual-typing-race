"""FastAPI dependencies: things a route can ask for by type annotation."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import ApiError
from app.core.security import InvalidTokenError, TokenType, decode_token
from app.core.settings import Settings
from app.models import User, UserRole
from app.services import users


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One database session per request, closed automatically when it ends."""
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    async with factory() as session:
        yield session


def get_redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
RedisDep = Annotated[Redis, Depends(get_redis)]

# auto_error=False so a missing header becomes *our* 401 shape, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise ApiError(401, "unauthorized", "Missing bearer token")
    try:
        claims = decode_token(credentials.credentials, TokenType.ACCESS)
    except InvalidTokenError as exc:
        raise ApiError(401, "unauthorized", "Invalid or expired token") from exc
    user = await users.get_user(session, claims.sub)
    if user is None:
        raise ApiError(401, "unauthorized", "User no longer exists")
    return user


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != UserRole.ADMIN:
        raise ApiError(403, "forbidden", "Admin role required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
