from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine

from app.api import health
from app.core.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Runs once at startup (before the yield) and once at shutdown (after it)."""
    settings = get_settings()
    app.state.engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    app.state.redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2)
    yield
    await app.state.redis.aclose()
    await app.state.engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Multilingual Typing Race API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    return app


app = create_app()
