"""Race rooms: live state in Redis, events over pub/sub, results in Postgres.

The contract is docs/race-protocol.md; section numbers below refer to it. The
WebSocket handler (app/api/rooms.py) is deliberately thin: it parses frames and
calls into here. Everything that can race between two connections (joining a
full room, assigning places) is a single Redis command or a Lua script, so it is
atomic even with several API replicas.

Keys (§7):
    room:{code}          HASH  the room itself
    room:{code}:players  HASH  player_id -> JSON
    room:{code}:events   pub/sub channel every server->client event goes through
"""

import asyncio
import json
import secrets
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.settings import Settings
from app.models import Language, Race, RaceResult, SessionMode, Text, User
from app.services import sessions, texts

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
CODE_LENGTH = 6
MAX_PLAYERS = 5
PROGRESS_MIN_INTERVAL = 0.2  # seconds; extra progress frames are dropped, not punished

LOBBY, COUNTDOWN, RUNNING, FINISHED = "lobby", "countdown", "running", "finished"


class RoomError(Exception):
    """A rule of the protocol was broken. `code` is what the client receives."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Player:
    id: str
    display_name: str
    joined_at: str
    connected: bool = True
    typed: int = 0
    errors: int = 0
    finished_at: str | None = None
    session_id: str | None = None
    place: int | None = None
    wpm: float | None = None
    accuracy: float | None = None
    valid: bool | None = None

    def to_json(self) -> str:
        return json.dumps(self.__dict__)

    @classmethod
    def from_json(cls, raw: str | bytes) -> "Player":
        return cls(**json.loads(raw))


@dataclass
class Room:
    code: str
    state: str
    host_id: str
    language: str
    difficulty: int
    created_at: str
    text_id: str | None = None
    text_content: str | None = None
    starts_at: str | None = None
    started_at: str | None = None
    race_id: str | None = None
    players: list[Player] = field(default_factory=list)

    def snapshot(self) -> dict[str, Any]:
        """The `room` frame (§4): everything a client needs to render the room."""
        text = None
        if self.text_id and self.text_content:
            text = {
                "id": self.text_id,
                "content": self.text_content,
                "char_count": len(self.text_content),
            }
        return {
            "type": "room",
            "code": self.code,
            "state": self.state,
            "host_id": self.host_id,
            "language": self.language,
            "difficulty": self.difficulty,
            "text": text,
            "starts_at": self.starts_at,
            "started_at": self.started_at,
            "players": [p.__dict__ for p in sorted(self.players, key=lambda p: p.joined_at)],
        }


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


# Atomic join (§2, §6): a returning player reconnects in any state; a new player
# only enters a lobby that has room. KEYS[1]=room, KEYS[2]=players.
_JOIN_LUA = """
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'no_room' end
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then
  local p = cjson.decode(existing)
  p.connected = true
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(p))
  return 'rejoined'
end
if state ~= 'lobby' then return 'wrong_state' end
if redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[3]) then return 'full' end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return 'joined'
"""


class RoomService:
    """One per process; holds the Redis client, the DB session factory and the
    timers this replica is responsible for."""

    def __init__(
        self,
        redis: Redis,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
    ) -> None:
        self.redis = redis
        self.session_factory = session_factory
        self.settings = settings
        self._join = redis.register_script(_JOIN_LUA)
        self._timers: set[asyncio.Task[None]] = set()

    # ---- keys -------------------------------------------------------------------

    @staticmethod
    def room_key(code: str) -> str:
        return f"room:{code}"

    @staticmethod
    def players_key(code: str) -> str:
        return f"room:{code}:players"

    @staticmethod
    def channel(code: str) -> str:
        return f"room:{code}:events"

    # ---- reads ------------------------------------------------------------------

    async def get_room(self, code: str) -> Room | None:
        raw = await self.redis.hgetall(self.room_key(code))
        if not raw:
            return None
        data = {_text(k): _text(v) for k, v in raw.items()}
        players_raw = await self.redis.hgetall(self.players_key(code))
        return Room(
            code=code,
            state=data["state"],
            host_id=data["host_id"],
            language=data["language"],
            difficulty=int(data["difficulty"]),
            created_at=data["created_at"],
            text_id=data.get("text_id"),
            text_content=data.get("text_content"),
            starts_at=data.get("starts_at"),
            started_at=data.get("started_at"),
            race_id=data.get("race_id"),
            players=[Player.from_json(v) for v in players_raw.values()],
        )

    async def require_room(self, code: str) -> Room:
        room = await self.get_room(code)
        if room is None:
            raise RoomError("no_room", "Room not found or expired")
        return room

    async def get_player(self, code: str, player_id: str) -> Player | None:
        raw = await self.redis.hget(self.players_key(code), player_id)
        return Player.from_json(raw) if raw else None

    # ---- writes -----------------------------------------------------------------

    async def _touch(self, code: str, state: str) -> None:
        """Rooms expire on their own (§2); every mutation refreshes the clock."""
        ttl = (
            int(self.settings.race_max_seconds) + 60
            if state in (COUNTDOWN, RUNNING)
            else self.settings.room_idle_ttl_seconds
        )
        await self.redis.expire(self.room_key(code), ttl)
        await self.redis.expire(self.players_key(code), ttl)

    async def _set_player(self, code: str, player: Player) -> None:
        await self.redis.hset(self.players_key(code), player.id, player.to_json())

    async def publish(self, code: str, event: dict[str, Any]) -> None:
        await self.redis.publish(self.channel(code), json.dumps(event))

    async def create_room(self, host: User, *, language: Language, difficulty: int) -> Room:
        for _ in range(10):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            created = await self.redis.hsetnx(self.room_key(code), "state", LOBBY)
            if created:
                break
        else:  # pragma: no cover - 32^6 codes; ten collisions in a row is not a real case
            raise RoomError("no_room", "Could not allocate a room code")
        await self.redis.hset(
            self.room_key(code),
            mapping={
                "host_id": str(host.id),
                "language": language.value,
                "difficulty": difficulty,
                "created_at": _iso(_now()),
            },
        )
        await self._touch(code, LOBBY)
        room = await self.require_room(code)
        return room

    async def join(self, code: str, user: User) -> Room:
        """Enter the room, or reconnect to it. Raises RoomError with the protocol code."""
        player = Player(id=str(user.id), display_name=user.display_name, joined_at=_iso(_now()))
        result = await self._join(
            keys=[self.room_key(code), self.players_key(code)],
            args=[player.id, player.to_json(), MAX_PLAYERS],
        )
        outcome = _text(result)
        if outcome == "no_room":
            raise RoomError("no_room", "Room not found or expired")
        if outcome == "wrong_state":
            raise RoomError("wrong_state", "The race has already started")
        if outcome == "full":
            raise RoomError("room_full", f"Rooms hold at most {MAX_PLAYERS} players")
        room = await self.require_room(code)
        await self._touch(code, room.state)
        if outcome == "joined":
            await self.publish(code, {"type": "player_joined", "player": player.__dict__})
        else:
            await self.publish(
                code, {"type": "player_connection", "player_id": player.id, "connected": True}
            )
        return room

    async def mark_disconnected(self, code: str, player_id: str) -> None:
        """Socket dropped. During a race the slot is kept (§6); in lobby/finished the
        player is removed after a grace period unless they come back."""
        player = await self.get_player(code, player_id)
        room = await self.get_room(code)
        if player is None or room is None:
            return
        player.connected = False
        await self._set_player(code, player)
        await self.publish(
            code, {"type": "player_connection", "player_id": player_id, "connected": False}
        )
        if room.state in (LOBBY, FINISHED):
            self._schedule(self._remove_if_still_gone(code, player_id))
        elif room.state == RUNNING:
            # If everyone still connected has already finished, don't wait for the timeout.
            await self._maybe_end_race(code)

    async def _remove_if_still_gone(self, code: str, player_id: str) -> None:
        await asyncio.sleep(self.settings.lobby_disconnect_grace_seconds)
        player = await self.get_player(code, player_id)
        if player is not None and not player.connected:
            await self.leave(code, player_id)

    async def leave(self, code: str, player_id: str) -> None:
        room = await self.get_room(code)
        if room is None:
            return
        removed = await self.redis.hdel(self.players_key(code), player_id)
        if not removed:
            return
        await self.publish(code, {"type": "player_left", "player_id": player_id})
        remaining = [p for p in room.players if p.id != player_id]
        if not remaining:
            await self.redis.delete(self.room_key(code), self.players_key(code))
            return
        if room.host_id == player_id:
            # Host handoff (§6): earliest-joined connected player, else earliest-joined.
            connected = [p for p in remaining if p.connected] or remaining
            new_host = min(connected, key=lambda p: p.joined_at)
            await self.redis.hset(self.room_key(code), "host_id", new_host.id)
            await self.publish(code, {"type": "host_changed", "host_id": new_host.id})
        await self._touch(code, room.state)

    async def start(self, code: str, host_id: str) -> None:
        """Host pressed start: pick a text, announce the countdown, arm the timer."""
        room = await self.require_room(code)
        if room.host_id != host_id:
            raise RoomError("not_host", "Only the host can start the race")
        if room.state != LOBBY:
            raise RoomError("wrong_state", "The race is not in the lobby")
        async with self.session_factory() as db:
            text = await texts.random_text(
                db, language=Language(room.language), difficulty=room.difficulty
            )
        if text is None:
            raise RoomError("no_text", "No text available for that language and difficulty")
        starts_at = _now() + timedelta(seconds=self.settings.race_countdown_seconds)
        # Everyone starts the new race fresh.
        for p in room.players:
            await self._set_player(
                code,
                Player(
                    id=p.id,
                    display_name=p.display_name,
                    joined_at=p.joined_at,
                    connected=p.connected,
                ),
            )
        await self.redis.hset(
            self.room_key(code),
            mapping={
                "state": COUNTDOWN,
                "text_id": str(text.id),
                "text_content": text.content,
                "starts_at": _iso(starts_at),
                "places": 0,
            },
        )
        await self.redis.hdel(self.room_key(code), "started_at", "race_id", "first_finish_at")
        await self._touch(code, COUNTDOWN)
        await self.publish(
            code,
            {
                "type": "countdown",
                "text": {
                    "id": str(text.id),
                    "content": text.content,
                    "char_count": len(text.content),
                },
                "starts_at": _iso(starts_at),
            },
        )
        self._schedule(self._go_at(code, starts_at))

    async def _go_at(self, code: str, starts_at: datetime) -> None:
        await asyncio.sleep(max(0.0, (starts_at - _now()).total_seconds()))
        room = await self.get_room(code)
        if room is None or room.state != COUNTDOWN or room.text_id is None:
            return
        started_at = _now()
        async with self.session_factory() as db:
            race = Race(
                code=code,
                language=Language(room.language),
                difficulty=room.difficulty,
                text_id=uuid.UUID(room.text_id),
                started_at=started_at,
            )
            db.add(race)
            await db.commit()
            race_id = str(race.id)
        await self.redis.hset(
            self.room_key(code),
            mapping={"state": RUNNING, "started_at": _iso(started_at), "race_id": race_id},
        )
        await self._touch(code, RUNNING)
        await self.publish(code, {"type": "started", "started_at": _iso(started_at)})
        self._schedule(self._end_after(code, race_id, self.settings.race_max_seconds))

    async def progress(self, code: str, player_id: str, typed: int, errors: int) -> None:
        room = await self.get_room(code)
        player = await self.get_player(code, player_id)
        if room is None or player is None or room.state != RUNNING or player.finished_at:
            return
        player.typed, player.errors = max(0, typed), max(0, errors)
        await self._set_player(code, player)
        await self.publish(
            code,
            {
                "type": "progress",
                "player_id": player_id,
                "typed": player.typed,
                "errors": player.errors,
            },
        )

    async def finish(
        self, code: str, user: User, *, started_at: datetime, raw_keystrokes: list[list[object]]
    ) -> None:
        """Score the log exactly like practice (§5), then assign a place by arrival order."""
        room = await self.require_room(code)
        player = await self.get_player(code, str(user.id))
        if room.state != RUNNING or room.race_id is None or room.started_at is None:
            raise RoomError("wrong_state", "The race is not running")
        if player is None:
            raise RoomError("not_in_room", "You are not in this room")
        if player.finished_at:
            raise RoomError("already_finished", "You already finished")
        now = _now()
        server_duration_ms = int((now - _parse(room.started_at)).total_seconds() * 1000)
        async with self.session_factory() as db:
            text = await db.get(Text, uuid.UUID(room.text_id or ""))
            if text is None:
                raise RoomError("no_text", "The race text disappeared")
            try:
                row = await sessions.record_session(
                    db,
                    user_id=user.id,
                    text=text,
                    started_at=started_at,
                    raw_keystrokes=raw_keystrokes,
                    mode=SessionMode.RACE,
                    race_id=uuid.UUID(room.race_id),
                    server_duration_ms=server_duration_ms,
                    now=now,
                )
            except sessions.SessionRejectedError as exc:
                raise RoomError("invalid_session", str(exc)) from exc
        place: int | None = None
        if row.is_valid:
            # HINCRBY is atomic: two replicas can never hand out the same place.
            place = int(await self.redis.hincrby(self.room_key(code), "places", 1))
        player.finished_at = _iso(now)
        player.session_id = str(row.id)
        player.place = place
        player.wpm = row.wpm
        player.accuracy = row.accuracy
        player.valid = row.is_valid
        player.typed = len(text.content_normalized)
        await self._set_player(code, player)
        first = await self.redis.hsetnx(self.room_key(code), "first_finish_at", _iso(now))
        await self.publish(
            code,
            {
                "type": "player_finished",
                "player_id": player.id,
                "place": place,
                "wpm": row.wpm,
                "accuracy": row.accuracy,
                "valid": row.is_valid,
            },
        )
        if first:
            self._schedule(
                self._end_after(code, room.race_id, self.settings.race_finish_grace_seconds)
            )
        await self._maybe_end_race(code)

    async def _end_after(self, code: str, race_id: str, seconds: float) -> None:
        await asyncio.sleep(seconds)
        room = await self.get_room(code)
        if room is not None and room.state == RUNNING and room.race_id == race_id:
            await self._end_race(room)

    async def _maybe_end_race(self, code: str) -> None:
        room = await self.get_room(code)
        if room is None or room.state != RUNNING:
            return
        still_typing = [p for p in room.players if p.connected and not p.finished_at]
        anyone_finished = any(p.finished_at for p in room.players)
        if anyone_finished and not still_typing:
            await self._end_race(room)

    async def _end_race(self, room: Room) -> None:
        """Freeze results (§5): unfinished players are DNF. Idempotent via HSETNX-style
        state check so two timers cannot both end the same race."""
        current = await self.redis.hget(self.room_key(room.code), "state")
        if current is None or _text(current) != RUNNING:
            return
        finished_at = _now()
        await self.redis.hset(
            self.room_key(room.code), mapping={"state": FINISHED, "finished_at": _iso(finished_at)}
        )
        results = []
        for p in sorted(room.players, key=lambda p: (p.place is None, p.place or 0, p.joined_at)):
            results.append(
                {
                    "player_id": p.id,
                    "display_name": p.display_name,
                    "place": p.place,
                    "wpm": p.wpm,
                    "accuracy": p.accuracy,
                    "valid": p.valid,
                    "dnf": p.finished_at is None,
                }
            )
        if room.race_id is not None:
            async with self.session_factory() as db:
                race = await db.get(Race, uuid.UUID(room.race_id))
                if race is not None:
                    race.finished_at = finished_at
                    for p in room.players:
                        db.add(
                            RaceResult(
                                race_id=race.id,
                                user_id=uuid.UUID(p.id),
                                session_id=uuid.UUID(p.session_id) if p.session_id else None,
                                place=p.place,
                            )
                        )
                    await db.commit()
        await self._touch(room.code, FINISHED)
        await self.publish(room.code, {"type": "race_over", "results": results})

    async def play_again(self, code: str, host_id: str) -> None:
        room = await self.require_room(code)
        if room.host_id != host_id:
            raise RoomError("not_host", "Only the host can start another race")
        if room.state != FINISHED:
            raise RoomError("wrong_state", "The race is not over yet")
        await self.redis.hset(self.room_key(code), "state", LOBBY)
        await self.redis.hdel(
            self.room_key(code),
            "text_id",
            "text_content",
            "starts_at",
            "started_at",
            "race_id",
            "first_finish_at",
            "places",
            "finished_at",
        )
        for p in room.players:
            await self._set_player(
                code,
                Player(
                    id=p.id,
                    display_name=p.display_name,
                    joined_at=p.joined_at,
                    connected=p.connected,
                ),
            )
        await self._touch(code, LOBBY)
        fresh = await self.require_room(code)
        await self.publish(code, fresh.snapshot())

    # ---- timers -----------------------------------------------------------------

    def _schedule(self, coro: Awaitable[None]) -> None:
        """Fire-and-forget on this replica's loop; kept in a set so GC cannot cancel it."""
        task = asyncio.ensure_future(coro)
        self._timers.add(task)
        task.add_done_callback(self._timers.discard)

    async def close(self) -> None:
        for task in list(self._timers):
            task.cancel()
        await asyncio.gather(*self._timers, return_exceptions=True)
