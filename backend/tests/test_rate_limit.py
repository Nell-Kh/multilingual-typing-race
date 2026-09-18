"""Rate limiting on the auth endpoints (ADR-022).

The API tests drive the real routes through the real Redis, because the parts
worth testing are the ones the unit tests can't see: which counter a route
spends, what the refusal looks like on the wire, and that the counter really
does expire.
"""

import asyncio

import pytest
from redis.asyncio import Redis

from app.core.deps import get_client_ip
from app.services.rate_limit import Limit, RateLimiter

from .conftest import AppClientFactory

pytestmark = pytest.mark.db

AUTH = "/api/v1/auth"
NELL = {"email": "nell@example.com", "password": "correct horse battery", "display_name": "Nell"}


def _fake_request(headers: dict[str, str], client_host: str | None) -> object:
    """The two attributes get_client_ip reads, without building a real request."""

    class Client:
        host = client_host

    class Request:
        def __init__(self) -> None:
            self.headers = headers
            self.client = Client() if client_host is not None else None

    return Request()


# ---- which address a limit counts against ----------------------------------------


def test_client_ip_prefers_the_last_forwarded_hop() -> None:
    # The client wrote "1.1.1.1"; the proxy in front of us appended what it saw.
    request = _fake_request({"x-forwarded-for": "1.1.1.1, 203.0.113.9"}, "10.0.0.1")

    assert get_client_ip(request) == "203.0.113.9"  # type: ignore[arg-type]


def test_client_ip_falls_back_to_the_socket_then_to_unknown() -> None:
    assert get_client_ip(_fake_request({}, "10.0.0.1")) == "10.0.0.1"  # type: ignore[arg-type]
    assert get_client_ip(_fake_request({}, None)) == "unknown"  # type: ignore[arg-type]


# ---- the limiter itself ------------------------------------------------------------


async def test_limiter_allows_up_to_the_ceiling_then_refuses(redis_available: str) -> None:
    redis = Redis.from_url(redis_available)
    try:
        await redis.flushdb()
        limiter = RateLimiter(redis)
        limit = Limit(times=3, seconds=60)

        allowances = [await limiter.hit("bucket", "someone", limit) for _ in range(4)]

        assert [a.allowed for a in allowances] == [True, True, True, False]
        assert [a.remaining for a in allowances] == [2, 1, 0, 0]
        assert allowances[-1].retry_after > 0
    finally:
        await redis.aclose()


async def test_limiter_counts_identities_separately_and_resets_one(redis_available: str) -> None:
    redis = Redis.from_url(redis_available)
    try:
        await redis.flushdb()
        limiter = RateLimiter(redis)
        limit = Limit(times=1, seconds=60)

        assert (await limiter.hit("bucket", "a", limit)).allowed is True
        assert (await limiter.hit("bucket", "b", limit)).allowed is True  # own counter
        assert (await limiter.hit("bucket", "a", limit)).allowed is False

        await limiter.reset("bucket", "a")

        assert (await limiter.hit("bucket", "a", limit)).allowed is True
        assert (await limiter.hit("bucket", "b", limit)).allowed is False  # untouched
    finally:
        await redis.aclose()


async def test_limiter_peek_reports_without_spending(redis_available: str) -> None:
    redis = Redis.from_url(redis_available)
    try:
        await redis.flushdb()
        limiter = RateLimiter(redis)
        limit = Limit(times=2, seconds=60)

        assert (await limiter.peek("bucket", "someone", limit)).remaining == 2
        assert (await limiter.peek("bucket", "someone", limit)).remaining == 2  # still 2

        await limiter.hit("bucket", "someone", limit)

        assert (await limiter.peek("bucket", "someone", limit)).remaining == 1
    finally:
        await redis.aclose()


async def test_limiter_allows_everything_when_redis_is_unreachable() -> None:
    """Fail open: a Redis outage must not take the login form down with it."""
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=1)
    try:
        limiter = RateLimiter(redis)

        allowance = await limiter.hit("bucket", "someone", Limit(times=1, seconds=60))

        assert allowance.allowed is True
        assert (await limiter.peek("bucket", "someone", Limit(1, 60))).allowed is True
        await limiter.reset("bucket", "someone")  # must not raise either
    finally:
        await redis.aclose()


# ---- the endpoints -------------------------------------------------------------------


async def test_register_refuses_past_the_ceiling_with_retry_after(
    app_client_factory: AppClientFactory,
) -> None:
    async with app_client_factory(rate_limit_register_per_ip=2) as client:
        for i in range(2):
            r = await client.post(f"{AUTH}/register", json={**NELL, "email": f"a{i}@example.com"})
            assert r.status_code == 201, r.text

        r = await client.post(f"{AUTH}/register", json={**NELL, "email": "a2@example.com"})

        assert r.status_code == 429
        assert r.json()["error"]["code"] == "rate_limited"
        assert 0 < int(r.headers["retry-after"]) <= 900


async def test_login_refuses_after_repeated_failures_on_one_email(
    app_client_factory: AppClientFactory,
) -> None:
    async with app_client_factory(rate_limit_login_failures_per_email=3) as client:
        await client.post(f"{AUTH}/register", json=NELL)

        for _ in range(3):
            r = await client.post(
                f"{AUTH}/login", json={"email": NELL["email"], "password": "wrong"}
            )
            assert r.status_code == 401

        r = await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "wrong"})
        assert r.status_code == 429

        # Even the right password is refused now — the counter is spent, not the
        # credentials. This is the deliberate cost of the rule (ADR-022).
        r = await client.post(
            f"{AUTH}/login", json={"email": NELL["email"], "password": NELL["password"]}
        )
        assert r.status_code == 429


async def test_login_failures_are_counted_per_email_not_globally(
    app_client_factory: AppClientFactory,
) -> None:
    async with app_client_factory(rate_limit_login_failures_per_email=2) as client:
        await client.post(f"{AUTH}/register", json=NELL)
        await client.post(f"{AUTH}/register", json={**NELL, "email": "other@example.com"})

        for _ in range(3):
            await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "no"})

        r = await client.post(
            f"{AUTH}/login", json={"email": "other@example.com", "password": NELL["password"]}
        )

        assert r.status_code == 200, "one locked account must not lock the others"


async def test_a_successful_login_clears_the_failure_counter(
    app_client_factory: AppClientFactory,
) -> None:
    async with app_client_factory(rate_limit_login_failures_per_email=3) as client:
        await client.post(f"{AUTH}/register", json=NELL)
        for _ in range(2):
            await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "typo"})

        ok = await client.post(
            f"{AUTH}/login", json={"email": NELL["email"], "password": NELL["password"]}
        )
        assert ok.status_code == 200

        # Back to a full allowance: three more failures are needed to refuse again.
        for _ in range(3):
            r = await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "x"})
            assert r.status_code == 401


async def test_the_window_expires_and_the_caller_is_let_back_in(
    app_client_factory: AppClientFactory,
) -> None:
    async with app_client_factory(
        rate_limit_register_per_ip=1, rate_limit_window_seconds=1
    ) as client:
        first = await client.post(f"{AUTH}/register", json=NELL)
        assert first.status_code == 201

        blocked = await client.post(f"{AUTH}/register", json={**NELL, "email": "b@example.com"})
        assert blocked.status_code == 429

        await asyncio.sleep(1.2)  # the counter's TTL, plus a little

        allowed = await client.post(f"{AUTH}/register", json={**NELL, "email": "c@example.com"})
        assert allowed.status_code == 201, "the window should have reset"


async def test_refresh_is_limited_per_address(app_client_factory: AppClientFactory) -> None:
    async with app_client_factory(rate_limit_refresh_per_ip=1) as client:
        registered = await client.post(f"{AUTH}/register", json=NELL)
        cookie = {"Cookie": registered.headers["set-cookie"].split(";")[0]}

        first = await client.post(f"{AUTH}/refresh", headers=cookie)
        assert first.status_code == 200

        second = await client.post(f"{AUTH}/refresh", headers=cookie)
        assert second.status_code == 429


async def test_limits_can_be_switched_off(app_client_factory: AppClientFactory) -> None:
    async with app_client_factory(rate_limit_enabled=False, rate_limit_register_per_ip=1) as client:
        for i in range(3):
            r = await client.post(f"{AUTH}/register", json={**NELL, "email": f"n{i}@example.com"})
            assert r.status_code == 201


async def test_a_limited_login_never_reaches_the_password_check(
    app_client_factory: AppClientFactory,
) -> None:
    """The refusal comes before argon2, so guessing costs the attacker, not us."""
    async with app_client_factory(rate_limit_login_failures_per_email=1) as client:
        await client.post(f"{AUTH}/register", json=NELL)
        await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "wrong"})

        started = asyncio.get_running_loop().time()
        r = await client.post(f"{AUTH}/login", json={"email": NELL["email"], "password": "wrong"})
        elapsed = asyncio.get_running_loop().time() - started

        assert r.status_code == 429
        # An argon2 verification is tens of milliseconds; a refusal is a Redis GET.
        assert elapsed < 0.05
