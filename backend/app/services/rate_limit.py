"""Fixed-window rate limiting in Redis (ADR-022).

One counter per (bucket, identity, window). `INCR` creates it at 1 and the first
hit gives it a TTL; when the TTL runs out the counter disappears and the caller
starts again. That is a *fixed* window, not a sliding one: a caller can spend the
whole allowance at the end of one window and again at the start of the next. For
guarding a login form that is fine — the point is to stop thousands of attempts,
not to meter exactly — and it costs one round trip and one short-lived key.

Two rules the implementation depends on:

* **Atomic.** `INCR` then `EXPIRE` as separate calls can lose the expiry if the
  process dies between them, and a counter with no TTL is a permanent ban. The
  Lua script runs both inside Redis.
* **Fail open.** If Redis is unreachable the limiter allows the request instead
  of raising. Turning a Redis blip into "nobody can log in" would be a worse
  outage than the one it prevents, and the endpoints this guards already fail on
  their own if Redis is really gone (refresh tokens live there too).
"""

from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

_PREFIX = "ratelimit:"

_HIT_LUA = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('TTL', KEYS[1])}
"""


@dataclass(frozen=True)
class Limit:
    """`times` requests allowed per `seconds`."""

    times: int
    seconds: int


@dataclass(frozen=True)
class Allowance:
    allowed: bool
    remaining: int
    retry_after: int  # seconds until the window resets; 0 when allowed


class RateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis
        self._hit = redis.register_script(_HIT_LUA)

    @staticmethod
    def key(bucket: str, identity: str) -> str:
        return f"{_PREFIX}{bucket}:{identity}"

    async def hit(self, bucket: str, identity: str, limit: Limit) -> Allowance:
        """Count one request against (bucket, identity) and say whether it may proceed."""
        try:
            count, ttl = await self._hit(keys=[self.key(bucket, identity)], args=[limit.seconds])
        except RedisError:
            return Allowance(allowed=True, remaining=limit.times, retry_after=0)
        count, ttl = int(count), int(ttl)
        if count > limit.times:
            # TTL is -1 only if the key somehow lost its expiry; charge the full window.
            return Allowance(False, 0, ttl if ttl > 0 else limit.seconds)
        return Allowance(True, limit.times - count, 0)

    async def peek(self, bucket: str, identity: str, limit: Limit) -> Allowance:
        """Same answer as `hit` without spending an attempt: for checks that run
        before the expensive work (a password verification) rather than after it."""
        try:
            raw = await self._redis.get(self.key(bucket, identity))
            ttl = int(await self._redis.ttl(self.key(bucket, identity)))
        except RedisError:
            return Allowance(allowed=True, remaining=limit.times, retry_after=0)
        count = int(raw) if raw is not None else 0
        if count >= limit.times:
            return Allowance(False, 0, ttl if ttl > 0 else limit.seconds)
        return Allowance(True, limit.times - count, 0)

    async def reset(self, bucket: str, identity: str) -> None:
        """Forget a counter — used when a login succeeds, so a few typos on the way
        in don't leave someone half-locked-out for the rest of the window."""
        try:
            await self._redis.delete(self.key(bucket, identity))
        except RedisError:
            return
