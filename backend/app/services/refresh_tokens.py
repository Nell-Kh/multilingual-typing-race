"""Server-side record of which refresh tokens are still valid.

A JWT can't be "un-issued", so we keep the id (`jti`) of every live refresh token
in Redis, with the same expiry as the token. Logout deletes the id; using a token
deletes its id and issues a fresh one (rotation), so a stolen refresh token stops
working the moment the real user refreshes, and a reused one is rejected.
"""

import uuid
from datetime import timedelta

from redis.asyncio import Redis

_PREFIX = "refresh:"


def _key(jti: uuid.UUID) -> str:
    return f"{_PREFIX}{jti}"


async def store(redis: Redis, jti: uuid.UUID, user_id: uuid.UUID, ttl: timedelta) -> None:
    await redis.set(_key(jti), str(user_id), ex=ttl)


async def consume(redis: Redis, jti: uuid.UUID) -> uuid.UUID | None:
    """Return the owner and invalidate the token in one atomic step, or None if unknown."""
    raw = await redis.getdel(_key(jti))
    return uuid.UUID(raw.decode() if isinstance(raw, bytes) else raw) if raw else None


async def revoke(redis: Redis, jti: uuid.UUID) -> None:
    await redis.delete(_key(jti))
