"""Stats, leaderboards and the daily challenge (ADR-019), through the HTTP API.

Runs are submitted through POST /sessions so every number below was produced by
the real scoring path, not inserted by hand.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app import cli
from app.models import Language
from app.services.stats import daily_index

pytestmark = pytest.mark.db

AUTH, TEXTS, SESSIONS = "/api/v1/auth", "/api/v1/texts", "/api/v1/sessions"
ME, BOARD, DAILY = "/api/v1/me", "/api/v1/leaderboards", "/api/v1/daily"


async def _login(client: AsyncClient, name: str) -> dict[str, str]:
    r = await client.post(
        f"{AUTH}/register",
        json={
            "email": f"{name}@example.com",
            "password": "correct horse battery",
            "display_name": name,
        },
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _text(client: AsyncClient, lang: str = "en") -> dict[str, object]:
    r = await client.get(f"{TEXTS}/random", params={"lang": lang, "difficulty": 1})
    assert r.status_code == 200
    body: dict[str, object] = r.json()
    return body


def _log(text: str, gap_ms: int) -> list[list[object]]:
    return [[gap_ms * (i + 1), ch, ch] for i, ch in enumerate(text)]


async def _run(
    client: AsyncClient,
    headers: dict[str, str],
    text: dict[str, object],
    *,
    gap_ms: int,
    mode: str = "practice",
) -> dict[str, object]:
    """Submit a clean run at `gap_ms` per key: WPM = 60000 / (5 * gap_ms)."""
    started = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
    r = await client.post(
        SESSIONS,
        json={
            "text_id": text["id"],
            "mode": mode,
            "started_at": started,
            "keystrokes": _log(str(text["content"]), gap_ms),
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


@pytest.fixture
async def seeded(app_client: AsyncClient, database: str) -> AsyncClient:
    assert await cli.seed_texts(database_url=database) == 0
    return app_client


# ---- personal stats -----------------------------------------------------------------


async def test_stats_summarise_valid_runs_per_language(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    en, he = await _text(seeded, "en"), await _text(seeded, "he")
    slow = await _run(seeded, nell, en, gap_ms=200)  # 60 wpm
    fast = await _run(seeded, nell, en, gap_ms=100)  # 120 wpm
    await _run(seeded, nell, he, gap_ms=150)  # 80 wpm
    assert slow["is_valid"] and fast["is_valid"]

    r = await seeded.get(f"{ME}/stats", headers=nell)

    assert r.status_code == 200
    body = r.json()
    by_lang = {s["language"]: s for s in body["languages"]}
    assert set(by_lang) == {"en", "he"}
    assert by_lang["en"]["runs"] == 2
    assert by_lang["en"]["best_wpm"] == 120.0
    assert by_lang["en"]["avg_wpm"] == 90.0
    assert by_lang["en"]["avg_accuracy"] == 100.0
    assert by_lang["he"]["best_wpm"] == 80.0
    assert [p["wpm"] for p in body["trend"]] == [60.0, 120.0, 80.0]  # oldest first


async def test_invalid_runs_are_stored_but_never_counted(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    en = await _text(seeded, "en")
    cheat = await _run(seeded, nell, en, gap_ms=1)  # machine_run

    assert cheat["is_valid"] is False
    stats = (await seeded.get(f"{ME}/stats", headers=nell)).json()
    assert stats["languages"] == [] and stats["trend"] == []
    history = (await seeded.get(f"{ME}/sessions", headers=nell)).json()
    assert len(history["items"]) == 1 and history["items"][0]["is_valid"] is False


async def test_session_history_is_paginated_and_private(seeded: AsyncClient) -> None:
    nell, sami = await _login(seeded, "nell"), await _login(seeded, "sami")
    en = await _text(seeded, "en")
    for _ in range(3):
        await _run(seeded, nell, en, gap_ms=150)
    await _run(seeded, sami, en, gap_ms=150)

    page1 = (await seeded.get(f"{ME}/sessions", params={"limit": 2}, headers=nell)).json()
    assert len(page1["items"]) == 2 and page1["next_cursor"]
    page2 = (
        await seeded.get(
            f"{ME}/sessions", params={"limit": 2, "cursor": page1["next_cursor"]}, headers=nell
        )
    ).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
    assert (await seeded.get(f"{ME}/sessions")).status_code == 401


async def test_key_aggregates_sum_across_runs(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    en = await _text(seeded, "en")
    content = str(en["content"])
    await _run(seeded, nell, en, gap_ms=150)
    await _run(seeded, nell, en, gap_ms=150)

    r = await seeded.get(f"{ME}/keys", params={"lang": "en"}, headers=nell)

    assert r.status_code == 200
    keys = {k["key"]: k for k in r.json()["keys"]}
    first = content[0]
    assert keys[first]["correct"] == 2 * content.count(first)
    assert keys[first]["errors"] == 0 and keys[first]["error_rate"] == 0.0
    assert (await seeded.get(f"{ME}/keys", params={"lang": "he"}, headers=nell)).json()[
        "keys"
    ] == []


# ---- leaderboards ------------------------------------------------------------------


async def test_leaderboard_ranks_each_users_best_valid_run(seeded: AsyncClient) -> None:
    nell, sami, dana = (
        await _login(seeded, "nell"),
        await _login(seeded, "sami"),
        await _login(seeded, "dana"),
    )
    en = await _text(seeded, "en")
    await _run(seeded, nell, en, gap_ms=200)  # 60
    await _run(seeded, nell, en, gap_ms=100)  # 120 <- nell's best
    await _run(seeded, sami, en, gap_ms=120)  # 100
    await _run(seeded, dana, en, gap_ms=1)  # invalid, never ranks
    await _run(seeded, dana, en, gap_ms=150)  # 80

    r = await seeded.get(BOARD, params={"lang": "en"})

    assert r.status_code == 200
    rows = r.json()["rows"]
    assert [(row["rank"], row["display_name"], row["wpm"]) for row in rows] == [
        (1, "nell", 120.0),
        (2, "sami", 100.0),
        (3, "dana", 80.0),
    ]
    assert r.json()["me"] is None  # anonymous viewer

    mine = (await seeded.get(BOARD, params={"lang": "en"}, headers=sami)).json()["me"]
    assert mine["rank"] == 2 and mine["wpm"] == 100.0
    assert (await seeded.get(BOARD, params={"lang": "he"})).json()["rows"] == []


async def _backdate(database: str, session_id: str, days: int) -> None:
    """The API refuses logs older than two hours, so an old run is aged in the database."""
    engine = create_async_engine(database)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE typing_sessions "
                    "SET started_at = started_at - make_interval(days => :d) WHERE id = :id"
                ),
                {"d": days, "id": session_id},
            )
    finally:
        await engine.dispose()


async def test_leaderboard_periods_are_utc_windows(seeded: AsyncClient, database: str) -> None:
    nell = await _login(seeded, "nell")
    en = await _text(seeded, "en")
    # A fast run eight days ago, a slower one just now.
    old = await _run(seeded, nell, en, gap_ms=100)
    await _backdate(database, str(old["id"]), days=8)
    await _run(seeded, nell, en, gap_ms=200)

    all_time = (await seeded.get(BOARD, params={"lang": "en", "period": "all"})).json()
    this_week = (await seeded.get(BOARD, params={"lang": "en", "period": "week"})).json()

    assert all_time["rows"][0]["wpm"] == 120.0
    assert this_week["rows"][0]["wpm"] == 60.0
    assert (await seeded.get(BOARD, params={"lang": "en", "period": "year"})).status_code == 422


# ---- daily challenge -------------------------------------------------------------------


def test_daily_index_is_stable_and_spread() -> None:
    day = date(2026, 9, 17)

    assert daily_index(day, Language.HE, 30) == daily_index(day, Language.HE, 30)
    assert daily_index(day, Language.HE, 30) != daily_index(day, Language.AR, 30)
    picks = {daily_index(day + timedelta(days=i), Language.EN, 30) for i in range(60)}
    assert len(picks) > 15  # sixty days should not keep landing on the same few texts


async def test_daily_text_is_the_same_for_everyone_and_scores_its_own_board(
    seeded: AsyncClient,
) -> None:
    nell, sami = await _login(seeded, "nell"), await _login(seeded, "sami")

    first = (await seeded.get(DAILY, params={"lang": "he"})).json()
    second = (await seeded.get(DAILY, params={"lang": "he"})).json()
    assert first["text"]["id"] == second["text"]["id"]
    assert first["day"] == datetime.now(UTC).date().isoformat()
    text = first["text"]

    await _run(seeded, nell, text, gap_ms=150, mode="daily")  # 80
    await _run(seeded, sami, text, gap_ms=100, mode="daily")  # 120
    await _run(seeded, nell, text, gap_ms=50, mode="practice")  # 240, but not a daily run

    board = (await seeded.get(f"{DAILY}/leaderboard", params={"lang": "he"}, headers=nell)).json()
    assert [(r["display_name"], r["wpm"]) for r in board["rows"]] == [
        ("sami", 120.0),
        ("nell", 80.0),
    ]
    assert board["me"]["rank"] == 2


async def test_daily_mode_refuses_any_other_text(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    daily = (await seeded.get(DAILY, params={"lang": "en"})).json()["text"]
    other = await _text(seeded, "en")
    while other["id"] == daily["id"]:
        other = await _text(seeded, "en")

    r = await seeded.post(
        SESSIONS,
        json={
            "text_id": other["id"],
            "mode": "daily",
            "started_at": datetime.now(UTC).isoformat(),
            "keystrokes": _log(str(other["content"]), 150),
        },
        headers=nell,
    )

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "not_daily_text"
