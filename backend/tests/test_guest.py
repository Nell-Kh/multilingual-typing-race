"""POST /sessions/guest: a visitor without an account gets the server's verdict and
numbers, and nothing is stored (ADR-034)."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text as sql
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app import cli
from tests.conftest import AppClientFactory

pytestmark = pytest.mark.db

TEXTS, GUEST = "/api/v1/texts", "/api/v1/sessions/guest"


@pytest.fixture
async def engine(database: str) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(database)
    yield eng
    await eng.dispose()


async def _rows(engine: AsyncEngine) -> tuple[int, int]:
    async with engine.connect() as conn:
        sessions = (await conn.execute(sql("SELECT count(*) FROM typing_sessions"))).scalar_one()
        keys = (await conn.execute(sql("SELECT count(*) FROM session_key_stats"))).scalar_one()
    return int(sessions), int(keys)


async def _a_text(client: AsyncClient, database: str) -> dict[str, object]:
    assert await cli.seed_texts(database_url=database) == 0
    r = await client.get(f"{TEXTS}/random", params={"lang": "ar", "difficulty": 1})
    assert r.status_code == 200
    body: dict[str, object] = r.json()
    return body


def _run(text: dict[str, object], gap_ms: int = 150) -> dict[str, object]:
    content = str(text["content"])
    return {
        "text_id": text["id"],
        "started_at": (datetime.now(UTC) - timedelta(seconds=60)).isoformat(),
        "keystrokes": [[gap_ms * (i + 1), ch, ch] for i, ch in enumerate(content)],
    }


async def test_guest_run_gets_a_verdict_and_writes_nothing(
    app_client: AsyncClient, database: str, engine: AsyncEngine
) -> None:
    text = await _a_text(app_client, database)
    before = await _rows(engine)

    r = await app_client.post(GUEST, json=_run(text, gap_ms=150))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] is False
    assert body["is_valid"] is True and body["invalid_reason"] is None
    assert body["language"] == "ar"
    # 150 ms a character = 400 characters a minute = 80 WPM, from the server's own replay.
    assert body["wpm"] == 80.0 and body["accuracy"] == 100.0
    assert body["duration_ms"] == 150 * len(str(text["content"]))
    assert {k["key"] for k in body["key_stats"]} == set(str(text["content"]))
    assert "id" not in body and "keystrokes" not in body
    # No session row, no key stats: nothing for stats or a leaderboard to read.
    assert await _rows(engine) == before == (0, 0)
    board = await app_client.get("/api/v1/leaderboards", params={"lang": "ar", "period": "all"})
    assert board.json()["rows"] == []


async def test_guest_run_goes_through_the_same_validator(
    app_client: AsyncClient, database: str, engine: AsyncEngine
) -> None:
    text = await _a_text(app_client, database)
    pasted = _run(text)
    pasted["keystrokes"] = [[1, c, c] for c in str(text["content"])]  # every key at once

    r = await app_client.post(GUEST, json=pasted)

    assert r.status_code == 200, r.text
    assert r.json()["is_valid"] is False
    assert r.json()["invalid_reason"] == "median_gap_too_low"
    assert await _rows(engine) == (0, 0)  # a refused guest run is not kept either


async def test_a_signed_in_caller_on_the_guest_endpoint_is_still_not_saved(
    app_client: AsyncClient, database: str, engine: AsyncEngine
) -> None:
    text = await _a_text(app_client, database)
    reg = await app_client.post(
        "/api/v1/auth/register",
        json={"email": "n@example.com", "password": "correct horse battery", "display_name": "N"},
    )
    auth = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    r = await app_client.post(GUEST, json=_run(text), headers=auth)

    assert r.status_code == 200
    assert await _rows(engine) == (0, 0)
    mine = await app_client.get("/api/v1/me/sessions", headers=auth)
    assert mine.json()["items"] == []


async def test_malformed_guest_logs_are_refused_like_any_other(
    app_client: AsyncClient, database: str
) -> None:
    text = await _a_text(app_client, database)
    bad = _run(text)
    bad["keystrokes"] = [["soon", "a", "a"]]
    assert (await app_client.post(GUEST, json=bad)).status_code == 422
    future = _run(text)
    future["started_at"] = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (await app_client.post(GUEST, json=future)).status_code == 422
    missing = _run(text)
    missing["text_id"] = "00000000-0000-0000-0000-000000000000"
    assert (await app_client.post(GUEST, json=missing)).status_code == 404


async def test_guest_runs_are_rate_limited_per_address(
    app_client_factory: AppClientFactory, database: str
) -> None:
    async with app_client_factory(rate_limit_guest_sessions_per_ip=2) as client:
        text = await _a_text(client, database)
        codes = [(await client.post(GUEST, json=_run(text))).status_code for _ in range(3)]
        assert codes == [200, 200, 429]
        refused = await client.post(GUEST, json=_run(text))
        assert refused.json()["error"]["code"] == "rate_limited"
        assert "Retry-After" in refused.headers


async def test_a_guest_cannot_reach_stats_races_or_the_daily_board_entry(
    app_client: AsyncClient, database: str
) -> None:
    text = await _a_text(app_client, database)
    # Everything that belongs to an account still needs one.
    assert (await app_client.get("/api/v1/me/stats")).status_code == 401
    assert (await app_client.get("/api/v1/me/sessions")).status_code == 401
    assert (
        await app_client.post("/api/v1/rooms", json={"language": "en", "difficulty": 1})
    ).status_code == 401
    daily = {**_run(text), "mode": "daily"}
    assert (await app_client.post("/api/v1/sessions", json=daily)).status_code == 401
    # And the guest endpoint does not take a mode: a daily run cannot be slipped in as a guest.
    assert "mode" not in (await app_client.post(GUEST, json=_run(text))).json()
