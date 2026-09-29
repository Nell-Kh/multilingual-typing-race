"""GET /daily/ghost: today's #1 as a ghost to race (ADR-035). Timings only — the name
and speed the daily board already shows, one time per character, no characters."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app import cli
from app.services.stats import progress_offsets
from app.services.typing_metrics import BACKSPACE

pytestmark = pytest.mark.db

AUTH, SESSIONS, DAILY = "/api/v1/auth", "/api/v1/sessions", "/api/v1/daily"


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


async def _submit(
    client: AsyncClient, headers: dict[str, str], text_id: object, log: list[list[object]]
) -> dict[str, object]:
    started = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
    r = await client.post(
        SESSIONS,
        json={"text_id": text_id, "mode": "daily", "started_at": started, "keystrokes": log},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


def _clean(content: str, gap_ms: int) -> list[list[object]]:
    return [[gap_ms * i, ch, ch] for i, ch in enumerate(content)]


@pytest.fixture
async def seeded(app_client: AsyncClient, database: str) -> AsyncClient:
    assert await cli.seed_texts(database_url=database) == 0
    return app_client


def test_offsets_are_when_each_character_was_typed_for_the_last_time() -> None:
    # "cat": c, a wrong key, backspace, a, t — the wrong key and the correction cancel out.
    log: list[list[object]] = [
        [1000, "c", "c"],
        [1100, "a", "x"],
        [1250, "", BACKSPACE],
        [1400, "a", "a"],
        [1500, "t", "t"],
    ]
    assert progress_offsets(log) == [0, 400, 500]  # measured from the first key
    assert progress_offsets([]) == []


async def test_no_ghost_until_someone_has_a_counted_run_today(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    r = await seeded.get(f"{DAILY}/ghost", params={"lang": "en"}, headers=nell)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_ghost"


async def test_the_ghost_is_todays_number_one_and_carries_timings_only(seeded: AsyncClient) -> None:
    nell, sami, dana = (
        await _login(seeded, "nell"),
        await _login(seeded, "sami"),
        await _login(seeded, "dana"),
    )
    daily = (await seeded.get(DAILY, params={"lang": "en"})).json()["text"]
    content = str(daily["content"])
    await _submit(seeded, nell, daily["id"], _clean(content, 150))  # 80 WPM
    fastest = await _submit(seeded, sami, daily["id"], _clean(content, 100))  # 120 WPM, #1
    # A pasted log is faster still, and refused, so it can never be the ghost.
    await _submit(seeded, dana, daily["id"], [[1, c, c] for c in content])

    r = await seeded.get(f"{DAILY}/ghost", params={"lang": "en"}, headers=nell)

    assert r.status_code == 200, r.text
    ghost = r.json()
    board = (await seeded.get(f"{DAILY}/leaderboard", params={"lang": "en"})).json()["rows"]
    assert board[0]["display_name"] == ghost["display_name"] == "sami"
    assert ghost["wpm"] == board[0]["wpm"] == fastest["wpm"]
    assert ghost["text_id"] == daily["id"]
    # Exactly these fields: public name and speed, and times. Nothing that was typed.
    assert set(ghost) == {"day", "language", "text_id", "display_name", "wpm", "offsets_ms"}
    offsets = ghost["offsets_ms"]
    assert all(isinstance(t, int) for t in offsets)
    assert offsets == [100 * i for i in range(len(content))]  # the replayed log, one per character


async def test_the_ghost_replays_corrections_as_the_run_happened(seeded: AsyncClient) -> None:
    nell = await _login(seeded, "nell")
    daily = (await seeded.get(DAILY, params={"lang": "en"})).json()["text"]
    content = str(daily["content"])
    # Human rhythm, one wrong key at the third character, corrected.
    log: list[list[object]] = [[0, content[0], content[0]], [140, content[1], content[1]]]
    log += [[280, content[2], "#"], [430, "", BACKSPACE], [560, content[2], content[2]]]
    log += [[560 + 140 * (i + 1), ch, ch] for i, ch in enumerate(content[3:])]
    await _submit(seeded, nell, daily["id"], log)

    offsets = (await seeded.get(f"{DAILY}/ghost", params={"lang": "en"}, headers=nell)).json()[
        "offsets_ms"
    ]

    assert len(offsets) == len(content)
    assert offsets[:4] == [0, 140, 560, 700]  # the third character counts from its correct key
    assert offsets == sorted(offsets)
    assert offsets == progress_offsets(log)


async def test_the_ghost_needs_an_account_like_the_daily_itself(seeded: AsyncClient) -> None:
    assert (await seeded.get(f"{DAILY}/ghost", params={"lang": "en"})).status_code == 401
