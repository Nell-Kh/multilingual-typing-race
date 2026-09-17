"""Race rooms end to end: two WebSocket clients against the real app, Redis and
Postgres (docs/race-protocol.md §9). Timers are shrunk to fractions of a second.

Starlette's TestClient runs the app on its own event loop in a thread, which is
what lets these tests be plain synchronous functions that drive two sockets.
"""

import asyncio
import contextlib
import json
import time
from collections.abc import Iterator
from typing import Any

import anyio
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.testclient import TestClient, WebSocketTestSession

from app import cli
from app.core.settings import Settings
from app.main import create_app
from app.models import Race, RaceResult, SessionMode, TypingSession
from app.services.rooms import MAX_PLAYERS

pytestmark = pytest.mark.db

ROOMS = "/api/v1/rooms"
COUNTDOWN_S = 0.2
FINISH_GRACE_S = 2.5  # longer than one simulated typing run (~1.3 s), shorter than patience
LOBBY_GRACE_S = 1.0
MIN_GAP_MS = 30  # the fastest median the validator accepts


async def _wipe(database_url: str, redis_url: str) -> None:
    from redis.asyncio import Redis

    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "TRUNCATE TABLE race_results, races, session_key_stats, typing_sessions, "
                    "texts, users CASCADE"
                )
            )
    finally:
        await engine.dispose()
    redis = Redis.from_url(redis_url)
    try:
        await redis.flushdb()
    finally:
        await redis.aclose()


@pytest.fixture
def client(database: str, redis_available: str) -> Iterator[TestClient]:
    asyncio.run(_wipe(database, redis_available))
    asyncio.run(cli.seed_texts(database_url=database))
    settings = Settings(
        app_env="test",
        database_url=database,
        redis_url=redis_available,
        race_countdown_seconds=COUNTDOWN_S,
        race_finish_grace_seconds=FINISH_GRACE_S,
        race_max_seconds=10,
        lobby_disconnect_grace_seconds=LOBBY_GRACE_S,
        ws_auth_timeout_seconds=1,
    )
    with TestClient(create_app(settings)) as c:
        yield c
        # A failed assertion leaves sockets open; close them or teardown hangs.
        for ws in list(_open_sockets):
            with contextlib.suppress(Exception):
                close(ws)


_open_sockets: list[WebSocketTestSession] = []


# ---- helpers ------------------------------------------------------------------


def register(client: TestClient, name: str) -> tuple[str, str]:
    """Returns (access token, user id)."""
    r = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"{name}@example.com",
            "password": "correct horse battery",
            "display_name": name,
        },
    )
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    return token, me["id"]


def create_room(client: TestClient, token: str, language: str = "he") -> str:
    r = client.post(
        ROOMS,
        json={"language": language, "difficulty": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    code: str = r.json()["code"]
    return code


def connect(
    client: TestClient, code: str, token: str
) -> tuple[WebSocketTestSession, dict[str, Any]]:
    ws = client.websocket_connect(f"{ROOMS}/{code}/ws")
    ws.__enter__()
    _open_sockets.append(ws)
    ws.send_json({"type": "auth", "token": token})
    snapshot = ws.receive_json()
    assert snapshot["type"] == "room", snapshot
    return ws, snapshot


def close(ws: WebSocketTestSession) -> None:
    """Drop the connection the way a closed tab does.

    The test session's own exit cancels the handler right after sending the
    close frame, which would cut its cleanup short; so send the close frame
    first, give the handler a moment to run `mark_disconnected`, then tear down.
    """
    if ws in _open_sockets:
        _open_sockets.remove(ws)
    ws.close(1000)
    time.sleep(0.15)
    ws.__exit__(None, None, None)


RECEIVE_TIMEOUT_S = 5.0


async def _receive_with_timeout(rx: Any) -> Any:
    with anyio.fail_after(RECEIVE_TIMEOUT_S):
        return await rx.receive()


def receive(ws: WebSocketTestSession) -> dict[str, Any]:
    """`ws.receive_json()` with a timeout, so a missing frame fails instead of hanging."""
    message = ws.portal.call(_receive_with_timeout, ws._send_rx)  # noqa: SLF001 - no public timeout
    if message["type"] == "websocket.close":
        raise AssertionError(f"socket closed: {message}")
    frame: dict[str, Any] = json.loads(message["text"])
    return frame


def until(ws: WebSocketTestSession, kind: str, **match: Any) -> dict[str, Any]:
    """Read frames until one of `kind` (optionally matching fields) arrives. A
    nested field is matched with a double underscore: player__id="..."."""
    for _ in range(50):
        frame = receive(ws)
        if frame["type"] != kind:
            continue
        ok = True
        for key, expected in match.items():
            value: Any = frame
            for part in key.split("__"):
                value = value.get(part) if isinstance(value, dict) else None
            ok = ok and value == expected
        if ok:
            return frame
    raise AssertionError(f"no {kind} frame")


def human_log(target: str, total_ms: int | None = None) -> list[list[Any]]:
    """A clean run of `target`, spread evenly over `total_ms` (default: as fast as
    the validator allows)."""
    gap = max(MIN_GAP_MS, (total_ms or 0) // max(1, len(target)))
    return [[gap * (i + 1), ch, ch] for i, ch in enumerate(target)]


def run_race_to_start(client: TestClient, n_players: int = 2) -> dict[str, Any]:
    """Register players, open a room, start it, and wait for `started`."""
    tokens = [register(client, f"p{i}") for i in range(n_players)]
    code = create_room(client, tokens[0][0])
    sockets = []
    for token, _ in tokens:
        ws, _ = connect(client, code, token)
        sockets.append(ws)
    sockets[0].send_json({"type": "start"})
    countdown = until(sockets[0], "countdown")
    started = [until(ws, "started") for ws in sockets]
    return {
        "code": code,
        "tokens": tokens,
        "sockets": sockets,
        "text": countdown["text"]["content"],
        "started_at": started[0]["started_at"],
        "t0": time.monotonic(),
    }


def finish(ws: WebSocketTestSession, race: dict[str, Any]) -> None:
    """Type the whole text honestly: the log's timestamps match the real time
    elapsed since `started`, so the server-clock check (§5) agrees."""
    target = race["text"]
    minimum = MIN_GAP_MS * len(target) / 1000
    elapsed = time.monotonic() - race["t0"]
    if elapsed < minimum:
        time.sleep(minimum - elapsed)
    total_ms = int((time.monotonic() - race["t0"]) * 1000)
    ws.send_json(
        {
            "type": "finish",
            "started_at": race["started_at"],
            "keystrokes": human_log(target, total_ms),
        }
    )


async def _db_counts(database_url: str) -> tuple[int, int, int]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            races = await conn.scalar(select(func.count()).select_from(Race))
            results = await conn.scalar(select(func.count()).select_from(RaceResult))
            race_sessions = await conn.scalar(
                select(func.count())
                .select_from(TypingSession)
                .where(TypingSession.mode == SessionMode.RACE)
            )
            return int(races or 0), int(results or 0), int(race_sessions or 0)
    finally:
        await engine.dispose()


# ---- HTTP ------------------------------------------------------------------------


def test_create_and_preview_room(client: TestClient) -> None:
    token, user_id = register(client, "host")

    code = create_room(client, token)
    assert len(code) == 6 and code.isupper()

    r = client.get(f"{ROOMS}/{code.lower()}")  # codes are case-insensitive
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "lobby" and body["host_id"] == user_id and body["players"] == []

    assert client.get(f"{ROOMS}/NOPE22").status_code == 404
    assert client.post(ROOMS, json={"language": "he", "difficulty": 1}).status_code == 401


# ---- joining ---------------------------------------------------------------------


def test_first_frame_must_be_auth(client: TestClient) -> None:
    token, _ = register(client, "host")
    code = create_room(client, token)

    with client.websocket_connect(f"{ROOMS}/{code}/ws") as ws:
        ws.send_json({"type": "start"})
        with pytest.raises(Exception) as exc:  # noqa: PT011 - Starlette raises its own type
            ws.receive_json()
    assert "4401" in str(exc.value) or getattr(exc.value, "code", None) == 4401


def test_bad_token_is_rejected(client: TestClient) -> None:
    token, _ = register(client, "host")
    code = create_room(client, token)

    with client.websocket_connect(f"{ROOMS}/{code}/ws") as ws:
        ws.send_json({"type": "auth", "token": "nope"})
        with pytest.raises(Exception) as exc:  # noqa: PT011
            ws.receive_json()
    assert getattr(exc.value, "code", None) == 4401


def test_second_player_joins_and_everyone_hears_it(client: TestClient) -> None:
    host, host_id = register(client, "host")
    guest, guest_id = register(client, "guest")
    code = create_room(client, host)

    ws_host, snap = connect(client, code, host)
    assert [p["id"] for p in snap["players"]] == [host_id]

    ws_guest, snap2 = connect(client, code, guest)
    assert [p["id"] for p in snap2["players"]] == [host_id, guest_id]
    assert until(ws_host, "player_joined", player__id=guest_id)["player"]["display_name"] == "guest"

    close(ws_host)
    close(ws_guest)


def test_room_is_full_at_five(client: TestClient) -> None:
    players = [register(client, f"p{i}") for i in range(MAX_PLAYERS + 1)]
    code = create_room(client, players[0][0])
    sockets = [connect(client, code, tok)[0] for tok, _ in players[:MAX_PLAYERS]]

    with client.websocket_connect(f"{ROOMS}/{code}/ws") as ws:
        ws.send_json({"type": "auth", "token": players[-1][0]})
        assert ws.receive_json()["code"] == "room_full"

    for ws in sockets:
        close(ws)


# ---- the race --------------------------------------------------------------------


def test_only_the_host_can_start(client: TestClient) -> None:
    host, _ = register(client, "host")
    guest, _ = register(client, "guest")
    code = create_room(client, host)
    ws_host, _ = connect(client, code, host)
    ws_guest, _ = connect(client, code, guest)

    ws_guest.send_json({"type": "start"})

    assert until(ws_guest, "error")["code"] == "not_host"
    close(ws_host)
    close(ws_guest)


def test_full_race_two_players(client: TestClient, database: str) -> None:
    race = run_race_to_start(client)
    ws1, ws2 = race["sockets"]
    (_, id1), (_, id2) = race["tokens"]

    # Progress is relayed to the *other* player.
    ws1.send_json({"type": "progress", "typed": 5, "errors": 1})
    assert until(ws2, "progress", player_id=id1) == {
        "type": "progress",
        "player_id": id1,
        "typed": 5,
        "errors": 1,
    }

    finish(ws1, race)
    first = until(ws2, "player_finished", player_id=id1)
    assert first["place"] == 1 and first["valid"] is True and first["wpm"] > 0

    finish(ws2, race)
    second = until(ws1, "player_finished", player_id=id2)
    assert second["place"] == 2

    # Everyone finished -> race over immediately, results in place order.
    over = until(ws1, "race_over")
    assert [(r["player_id"], r["place"], r["dnf"]) for r in over["results"]] == [
        (id1, 1, False),
        (id2, 2, False),
    ]
    assert until(ws2, "race_over") == over

    races, results, race_sessions = asyncio.run(_db_counts(database))
    assert (races, results, race_sessions) == (1, 2, 2)

    # Play again: back to the lobby with a fresh snapshot for everyone.
    ws1.send_json({"type": "play_again"})
    for ws in (ws1, ws2):
        snap = until(ws, "room")
        assert snap["state"] == "lobby" and snap["text"] is None
        assert all(p["place"] is None and p["finished_at"] is None for p in snap["players"])
    close(ws1)
    close(ws2)


def test_pasted_log_gets_no_place(client: TestClient) -> None:
    race = run_race_to_start(client)
    ws1, ws2 = race["sockets"]
    (_, id1), (_, id2) = race["tokens"]
    target = race["text"]

    ws1.send_json(  # every key at once: machine_run
        {
            "type": "finish",
            "started_at": race["started_at"],
            "keystrokes": [[1, c, c] for c in target],
        }
    )
    cheat = until(ws2, "player_finished", player_id=id1)
    assert cheat["valid"] is False and cheat["place"] is None

    finish(ws2, race)
    honest = until(ws1, "player_finished", player_id=id2)
    assert honest["valid"] is True and honest["place"] == 1

    over = until(ws1, "race_over")
    by_id = {r["player_id"]: r for r in over["results"]}
    assert by_id[id2]["place"] == 1 and by_id[id1]["place"] is None and by_id[id1]["dnf"] is False
    close(ws1)
    close(ws2)


def test_finishing_twice_is_refused(client: TestClient) -> None:
    race = run_race_to_start(client, n_players=1)
    (ws,) = race["sockets"]

    finish(ws, race)
    until(ws, "player_finished")
    ws.send_json(
        {"type": "finish", "started_at": race["started_at"], "keystrokes": human_log(race["text"])}
    )

    frame = until(ws, "error")
    assert frame["code"] in ("already_finished", "wrong_state")
    close(ws)


def test_race_ends_after_grace_period_with_dnf(client: TestClient) -> None:
    race = run_race_to_start(client)
    ws1, ws2 = race["sockets"]
    (_, id1), (_, id2) = race["tokens"]

    finish(ws1, race)
    until(ws1, "player_finished", player_id=id1)

    # Player 2 never finishes; the grace timer ends the race.
    over = until(ws2, "race_over")
    by_id = {r["player_id"]: r for r in over["results"]}
    assert by_id[id1]["place"] == 1 and by_id[id2]["dnf"] is True and by_id[id2]["place"] is None
    close(ws1)
    close(ws2)


# ---- disconnects and the host ------------------------------------------------------


def test_disconnect_during_race_keeps_the_slot_and_reconnect_gets_a_snapshot(
    client: TestClient,
) -> None:
    race = run_race_to_start(client)
    ws1, ws2 = race["sockets"]
    (tok1, id1), _ = race["tokens"]

    close(ws1)
    gone = until(ws2, "player_connection", player_id=id1)
    assert gone["connected"] is False

    ws1b, snap = connect(client, race["code"], tok1)
    assert snap["state"] == "running" and snap["text"]["content"] == race["text"]
    assert {p["id"]: p["connected"] for p in snap["players"]}[id1] is True
    assert until(ws2, "player_connection", player_id=id1)["connected"] is True
    close(ws1b)
    close(ws2)


def test_host_leaving_the_lobby_hands_off_to_the_next_player(client: TestClient) -> None:
    host, host_id = register(client, "host")
    guest, guest_id = register(client, "guest")
    code = create_room(client, host)
    ws_host, _ = connect(client, code, host)
    ws_guest, _ = connect(client, code, guest)
    until(ws_host, "player_joined", player__id=guest_id)

    ws_host.send_json({"type": "leave"})

    assert until(ws_guest, "player_left")["player_id"] == host_id
    assert until(ws_guest, "host_changed")["host_id"] == guest_id
    assert client.get(f"{ROOMS}/{code}").json()["host_id"] == guest_id
    close(ws_guest)


def test_refresh_in_lobby_is_not_a_leave(client: TestClient) -> None:
    host, host_id = register(client, "host")
    guest, _ = register(client, "guest")
    code = create_room(client, host)
    ws_host, _ = connect(client, code, host)
    ws_guest, _ = connect(client, code, guest)
    until(ws_host, "player_joined")

    close(ws_host)  # a refresh: socket drops, no `leave`
    assert until(ws_guest, "player_connection", player_id=host_id)["connected"] is False
    ws_host2, snap = connect(client, code, host)  # back within the grace period
    assert snap["host_id"] == host_id and len(snap["players"]) == 2

    time.sleep(LOBBY_GRACE_S * 2)
    assert client.get(f"{ROOMS}/{code}").json()["host_id"] == host_id  # still host, still there
    close(ws_host2)
    close(ws_guest)


def test_empty_room_disappears(client: TestClient) -> None:
    host, _ = register(client, "host")
    code = create_room(client, host)
    ws, _ = connect(client, code, host)

    ws.send_json({"type": "leave"})
    time.sleep(0.2)

    assert client.get(f"{ROOMS}/{code}").status_code == 404
