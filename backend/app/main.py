from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api import health, v1
from app.core.errors import install_error_handlers
from app.core.settings import Settings, get_settings
from app.db.session import create_engine, create_session_factory


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Runs once at startup (before the yield) and once at shutdown (after it)."""
    settings: Settings = app.state.settings
    engine = create_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.state.redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2)
    yield
    await app.state.redis.aclose()
    await engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Tests pass their own settings (test database, test Redis)."""
    settings = settings or get_settings()
    app = FastAPI(title="Multilingual Typing Race API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(v1.router)
    return app


app = create_app()
