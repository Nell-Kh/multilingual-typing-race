"""Turning a spent allowance into the API's 429 (ADR-022, ADR-026).

The counting lives in `services/rate_limit.py`, which knows nothing about HTTP.
This is the other half: the one place that decides what a refusal looks like on
the wire, so every limited endpoint refuses the same way.
"""

from app.core.errors import ApiError
from app.core.settings import Settings
from app.services.rate_limit import Allowance, Limit, RateLimiter


def refuse(allowance: Allowance) -> None:
    raise ApiError(
        429,
        "rate_limited",
        "Too many attempts. Try again in a few minutes.",
        headers={"Retry-After": str(allowance.retry_after)},
    )


async def enforce(
    limiter: RateLimiter, settings: Settings, bucket: str, identity: str, times: int
) -> None:
    """Count one attempt against (bucket, identity) and refuse if that spent the last."""
    if not settings.rate_limit_enabled:
        return
    allowance = await limiter.hit(
        bucket, identity, Limit(times, settings.rate_limit_window_seconds)
    )
    if not allowance.allowed:
        refuse(allowance)
