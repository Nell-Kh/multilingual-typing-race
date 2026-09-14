from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import health
from app.main import app, lifespan


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    # ASGITransport calls the app in-process (no server, no network) but does NOT
    # run startup/shutdown, so we enter the lifespan ourselves to populate app.state.
    async with lifespan(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


async def _ok(_: object) -> health.CheckResult:
    return "ok"


async def _error(_: object) -> health.CheckResult:
    return "error"


async def test_healthz_ok_when_all_checks_pass(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_db", _ok)
    monkeypatch.setattr(health, "check_redis", _ok)

    r = await client.get("/healthz")

    assert r.status_code == 200
    assert r.json() == {"status": "ok", "checks": {"db": "ok", "redis": "ok"}}


async def test_healthz_503_when_a_check_fails(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_db", _ok)
    monkeypatch.setattr(health, "check_redis", _error)

    r = await client.get("/healthz")

    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "checks": {"db": "ok", "redis": "error"}}
