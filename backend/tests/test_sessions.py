"""POST /sessions: the log goes in, the server's verdict and numbers come out."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app import cli
from app.services.typing_metrics import BACKSPACE

pytestmark = pytest.mark.db

AUTH, TEXTS, SESSIONS = "/api/v1/auth", "/api/v1/texts", "/api/v1/sessions"


async def _login(client: AsyncClient, email: str = "nell@example.com") -> dict[str, str]:
    r = await client.post(
        f"{AUTH}/register",
        json={"email": email, "password": "correct horse battery", "display_name": "N"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _a_text(client: AsyncClient, database: str) -> dict[str, object]:
    assert await cli.seed_texts(database_url=database) == 0
    r = await client.get(f"{TEXTS}/random", params={"lang": "en", "difficulty": 1})
    assert r.status_code == 200
    body: dict[str, object] = r.json()
    return body


def _human_log(text: str, gap_ms: int = 120) -> list[list[object]]:
    return [[gap_ms * (i + 1), ch, ch] for i, ch in enumerate(text)]


def _started(seconds_ago: int = 60) -> str:
    return (datetime.now(UTC) - timedelta(seconds=seconds_ago)).isoformat()


async def test_honest_practice_session_is_stored_and_scored(
    app_client: AsyncClient, database: str
) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)
    content = str(text["content"])
    log = _human_log(content, gap_ms=100)

    r = await app_client.post(
        SESSIONS,
        json={"text_id": text["id"], "started_at": _started(), "keystrokes": log},
        headers=auth,
    )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_valid"] is True
    assert body["invalid_reason"] is None
    assert body["mode"] == "practice"
    assert body["language"] == "en"
    assert body["error_count"] == 0
    assert body["accuracy"] == 100.0
    assert body["keystroke_count"] == len(content)
    assert body["duration_ms"] == 100 * len(content)
    # 100 ms per char = 600 chars/min = 120 WPM, exactly.
    assert body["wpm"] == 120.0
    assert {s["key"] for s in body["key_stats"]} == set(content)
    assert "keystrokes" not in body  # the raw log is stored but never echoed back


async def test_corrected_typo_lowers_accuracy_but_stays_valid(
    app_client: AsyncClient, database: str
) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)
    content = str(text["content"])
    log: list[list[object]] = [[100, content[0], content[0]], [220, content[1], "#"]]
    log += [[300, "", BACKSPACE], [420, content[1], content[1]]]
    log += [[420 + 120 * (i + 1), ch, ch] for i, ch in enumerate(content[2:])]

    r = await app_client.post(
        SESSIONS,
        json={"text_id": text["id"], "started_at": _started(), "keystrokes": log},
        headers=auth,
    )

    body = r.json()
    assert r.status_code == 201, r.text
    assert body["is_valid"] is True
    assert body["error_count"] == 1
    assert body["accuracy"] < 100


async def test_pasted_text_is_stored_as_invalid(app_client: AsyncClient, database: str) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)
    log = _human_log(str(text["content"]), gap_ms=2)  # 2 ms per key: not a human

    r = await app_client.post(
        SESSIONS,
        json={"text_id": text["id"], "started_at": _started(), "keystrokes": log},
        headers=auth,
    )

    assert r.status_code == 201  # stored for inspection...
    assert r.json()["is_valid"] is False  # ...but never counted
    assert r.json()["invalid_reason"] == "median_gap_too_low"


async def test_wrong_text_is_stored_as_invalid(app_client: AsyncClient, database: str) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)
    log = _human_log(str(text["content"])[:-1] + "?")

    r = await app_client.post(
        SESSIONS,
        json={"text_id": text["id"], "started_at": _started(), "keystrokes": log},
        headers=auth,
    )

    assert r.status_code == 201
    assert r.json()["invalid_reason"] == "text_mismatch"


@pytest.mark.parametrize(
    ("log", "message"),
    [
        ([[1, "a"]], "keystroke 0"),
        ([[0, "a", "a"]], "after the start"),
    ],
)
async def test_malformed_logs_are_422(
    app_client: AsyncClient, database: str, log: list[list[object]], message: str
) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)

    r = await app_client.post(
        SESSIONS,
        json={"text_id": text["id"], "started_at": _started(), "keystrokes": log},
        headers=auth,
    )

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_session"
    assert message in r.json()["error"]["message"]


async def test_stale_started_at_is_rejected(app_client: AsyncClient, database: str) -> None:
    auth = await _login(app_client)
    text = await _a_text(app_client, database)

    r = await app_client.post(
        SESSIONS,
        json={
            "text_id": text["id"],
            "started_at": _started(seconds_ago=3 * 3600),
            "keystrokes": _human_log(str(text["content"])),
        },
        headers=auth,
    )

    assert r.status_code == 422
    assert "too long ago" in r.json()["error"]["message"]


async def test_unknown_text_is_404(app_client: AsyncClient, database: str) -> None:
    auth = await _login(app_client)

    r = await app_client.post(
        SESSIONS,
        json={
            "text_id": "00000000-0000-0000-0000-000000000000",
            "started_at": _started(),
            "keystrokes": [[100, "a", "a"]],
        },
        headers=auth,
    )

    assert r.status_code == 404


async def test_submit_requires_login(app_client: AsyncClient) -> None:
    r = await app_client.post(SESSIONS, json={})

    assert r.status_code == 401


async def test_get_session_only_for_its_owner(app_client: AsyncClient, database: str) -> None:
    owner = await _login(app_client, "owner@example.com")
    text = await _a_text(app_client, database)
    created = (
        await app_client.post(
            SESSIONS,
            json={
                "text_id": text["id"],
                "started_at": _started(),
                "keystrokes": _human_log(str(text["content"])),
            },
            headers=owner,
        )
    ).json()
    someone_else = await _login(app_client, "other@example.com")

    mine = await app_client.get(f"{SESSIONS}/{created['id']}", headers=owner)
    theirs = await app_client.get(f"{SESSIONS}/{created['id']}", headers=someone_else)

    assert mine.status_code == 200
    assert mine.json()["wpm"] == created["wpm"]
    assert len(mine.json()["key_stats"]) == len(created["key_stats"])
    assert theirs.status_code == 404  # not 403: don't confirm the id exists
