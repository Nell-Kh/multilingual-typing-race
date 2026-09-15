from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.settings import get_settings


def create_engine(url: str | None = None) -> AsyncEngine:
    """One engine per process: it owns the connection pool."""
    return create_async_engine(url or get_settings().database_url, pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """One session per request, handed out by `app.core.deps.get_session`."""
    return async_sessionmaker(engine, expire_on_commit=False)
