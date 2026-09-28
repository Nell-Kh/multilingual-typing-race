"""Race rooms: live state in Redis, events over pub/sub, results in Postgres.

The contract is docs/race-protocol.md; section numbers below refer to it. The
WebSocket handler (app/api/rooms.py) is deliberately thin: it parses frames and
calls into here. Everything that can race between two connections or two
replicas - joining a full room, starting, every state transition, assigning
places, a player's own fields - is a single Redis command or a Lua script.

State changes that happen *on a clock* (countdown -> running, running ->
finished, dropping a player who left the lobby) are lazy (ADR-031): the deadline
is stored in the room, and `tick()` performs any transition that is due. Every
socket's relay loop ticks about once a second, every incoming frame ticks, and
joining ticks, so a room moves on as long as anyone is looking at it - on any
replica, and after a restart. The in-process timers are only there to make the
transition land on time instead of up to a tick late.

Keys (§7):
    room:{code}          HASH  the room itself, including starts_at_ms / deadline_ms
    room:{code}:players  HASH  player_id -> JSON (see Player)
    room:{code}:events   pub/sub channel every server->client event goes through
"""

import asyncio
import json
import logging
import secrets
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.settings import Settings
from app.models import Language, Race, RaceResult, SessionMode, Text, User
from app.services import sessions, texts

log = logging.getLogger(__name__)

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


_PRIVATE_PLAYER_FIELDS = frozenset({"conn", "disconnected_at_ms"})


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
    # Which socket is this player's current one (ADR-031). A second tab for the same
    # account takes over; closing the old tab then no longer marks the player gone.
    conn: str | None = None
    disconnected_at_ms: int | None = None

    def to_json(self) -> str:
        return json.dumps(self.__dict__)

    def public(self) -> dict[str, Any]:
        """What other players see: everything but the connection bookkeeping."""
        return {k: v for k, v in self.__dict__.items() if k not in _PRIVATE_PLAYER_FIELDS}

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
            "players": [p.public() for p in sorted(self.players, key=lambda p: p.joined_at)],
        }


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _ms(dt: datetime) -> int:
    """Epoch milliseconds: what the Lua scripts compare deadlines in."""
    return int(dt.timestamp() * 1000)


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


# Atomic join (§2, §6): a returning player reconnects in any state; a new player
# only enters a lobby that has room. Either way this socket becomes the player's
# current connection. KEYS[1]=room, KEYS[2]=players; ARGV: id, new player JSON,
# max players, connection id.
_JOIN_LUA = """
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'no_room' end
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then
  local p = cjson.decode(existing)
  p.connected = true
  p.conn = ARGV[4]
  p.disconnected_at_ms = cjson.null
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(p))
  return 'rejoined'
end
if state ~= 'lobby' then return 'wrong_state' end
if redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[3]) then return 'full' end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return 'joined'
"""

# A socket closed. Only the player's *current* socket may mark them gone: an old
# tab closing after a new one took over changes nothing. KEYS[1]=players;
# ARGV: id, connection id, now_ms.
_DISCONNECT_LUA = """
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 'gone' end
local p = cjson.decode(raw)
if p.conn ~= ARGV[2] then return 'stale' end
p.connected = false
p.disconnected_at_ms = tonumber(ARGV[3])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(p))
return 'disconnected'
"""

# Merge fields into one player's JSON in place, so two writers touching different
# fields (progress and a disconnect, say) cannot undo each other. ARGV[3] is a
# guard: 'unfinished' skips a player who already finished. KEYS[1]=players;
# ARGV: id, JSON patch, guard.
_PATCH_PLAYER_LUA = """
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local p = cjson.decode(raw)
if ARGV[3] == 'unfinished' and p.finished_at ~= nil and p.finished_at ~= cjson.null then
  return 0
end
for k, v in pairs(cjson.decode(ARGV[2])) do p[k] = v end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(p))
return 1
"""

# Clear every player's race fields, keeping who they are and how they are connected.
_RESET_PLAYERS = """
for i, raw in ipairs(redis.call('HVALS', KEYS[2])) do
  local p = cjson.decode(raw)
  local fresh = {id = p.id, display_name = p.display_name, joined_at = p.joined_at,
                 connected = p.connected, conn = p.conn,
                 disconnected_at_ms = p.disconnected_at_ms,
                 typed = 0, errors = 0}
  redis.call('HSET', KEYS[2], p.id, cjson.encode(fresh))
end
"""

# lobby -> countdown, for the host only, once (§2). The text is chosen before this
# runs, so there is no await between the check and the write. KEYS[1]=room,
# KEYS[2]=players; ARGV: host id, text id, text content, starts_at ISO, starts_at ms.
_START_LUA = (
    """
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'no_room' end
if redis.call('HGET', KEYS[1], 'host_id') ~= ARGV[1] then return 'not_host' end
if state ~= 'lobby' then return 'wrong_state' end
"""
    + _RESET_PLAYERS
    + """
redis.call('HSET', KEYS[1], 'state', 'countdown', 'text_id', ARGV[2],
           'text_content', ARGV[3], 'starts_at', ARGV[4], 'starts_at_ms', ARGV[5],
           'places', 0)
redis.call('HDEL', KEYS[1], 'started_at', 'race_id', 'first_finish_at', 'deadline_ms',
           'finished_at')
return 'ok'
"""
)

# countdown -> running once starts_at has passed. Exactly one caller wins, on any
# replica. KEYS[1]=room; ARGV: now_ms, started_at ISO, race id, deadline ms.
_GO_LUA = """
if redis.call('HGET', KEYS[1], 'state') ~= 'countdown' then return 0 end
local starts = tonumber(redis.call('HGET', KEYS[1], 'starts_at_ms'))
if not starts or starts > tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 'state', 'running', 'started_at', ARGV[2], 'race_id', ARGV[3],
           'deadline_ms', ARGV[4])
return 1
"""

# running -> finished, once: when the deadline has passed, or unconditionally
# when ARGV[4] is '1' (everyone still connected has finished). KEYS[1]=room;
# ARGV: now_ms, finished_at ISO, race id, force.
_END_LUA = """
if redis.call('HGET', KEYS[1], 'state') ~= 'running' then return 0 end
if redis.call('HGET', KEYS[1], 'race_id') ~= ARGV[3] then return 0 end
if ARGV[4] ~= '1' then
  local deadline = tonumber(redis.call('HGET', KEYS[1], 'deadline_ms'))
  if not deadline or deadline > tonumber(ARGV[1]) then return 0 end
end
redis.call('HSET', KEYS[1], 'state', 'finished', 'finished_at', ARGV[2])
return 1
"""

# finished -> lobby for the host (§2), once.
_PLAY_AGAIN_LUA = (
    """
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'no_room' end
if redis.call('HGET', KEYS[1], 'host_id') ~= ARGV[1] then return 'not_host' end
if state ~= 'finished' then return 'wrong_state' end
"""
    + _RESET_PLAYERS
    + """
redis.call('HSET', KEYS[1], 'state', 'lobby')
redis.call('HDEL', KEYS[1], 'text_id', 'text_content', 'starts_at', 'starts_at_ms',
           'started_at', 'race_id', 'first_finish_at', 'places', 'finished_at', 'deadline_ms')
return 'ok'
"""
)

# In lobby/finished, remove players whose socket has been gone longer than the
# grace period (§6). Returns the ids removed. KEYS[1]=room, KEYS[2]=players;
# ARGV: now_ms, grace ms.
_SWEEP_LUA = """
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'lobby' and state ~= 'finished' then return {} end
local removed = {}
for i, raw in ipairs(redis.call('HVALS', KEYS[2])) do
  local p = cjson.decode(raw)
  local gone = p.disconnected_at_ms
  if p.connected == false and gone ~= nil and gone ~= cjson.null
     and tonumber(gone) + tonumber(ARGV[2]) <= tonumber(ARGV[1]) then
    redis.call('HDEL', KEYS[2], p.id)
    table.insert(removed, p.id)
  end
end
return removed
"""

# Hand the host role over only if it is still held by the player who left, so two
# callers cleaning up the same departure cannot hand it over twice.
# KEYS[1]=room; ARGV: expected host, new host.
_HANDOFF_LUA = """
if redis.call('HGET', KEYS[1], 'host_id') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'host_id', ARGV[2])
return 1
"""


class RoomService:
    """One per process; holds the Redis client, the DB session factory and the
    timers that make this replica's transitions land on time. Nothing here depends
    on those timers for correctness (ADR-031)."""

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
        self._disconnect = redis.register_script(_DISCONNECT_LUA)
        self._patch = redis.register_script(_PATCH_PLAYER_LUA)
        self._start = redis.register_script(_START_LUA)
        self._go = redis.register_script(_GO_LUA)
        self._end = redis.register_script(_END_LUA)
        self._play_again = redis.register_script(_PLAY_AGAIN_LUA)
        self._sweep = redis.register_script(_SWEEP_LUA)
        self._handoff = redis.register_script(_HANDOFF_LUA)
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

    def _keys(self, code: str) -> list[str]:
        return [self.room_key(code), self.players_key(code)]

    # ---- reads ------------------------------------------------------------------

    async def get_room(self, code: str) -> Room | None:
        raw = await self.redis.hgetall(self.room_key(code))
        if not raw:
            return None
        data = {_text(k): _text(v) for k, v in raw.items()}
        if "host_id" not in data:  # created a moment ago and not filled in yet
            return None
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

    async def _patch_player(
        self, code: str, player_id: str, fields: dict[str, Any], *, unfinished: bool = False
    ) -> bool:
        done = await self._patch(
            keys=[self.players_key(code)],
            args=[player_id, json.dumps(fields), "unfinished" if unfinished else ""],
        )
        return bool(done)

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

    async def join(self, code: str, user: User, conn: str) -> Room:
        """Enter the room, or reconnect to it, as connection `conn`. Raises RoomError
        with the protocol code."""
        player = Player(
            id=str(user.id), display_name=user.display_name, joined_at=_iso(_now()), conn=conn
        )
        result = await self._join(
            keys=self._keys(code), args=[player.id, player.to_json(), MAX_PLAYERS, conn]
        )
        outcome = _text(result)
        if outcome == "no_room":
            raise RoomError("no_room", "Room not found or expired")
        if outcome == "wrong_state":
            raise RoomError("wrong_state", "The race has already started")
        if outcome == "full":
            raise RoomError("room_full", f"Rooms hold at most {MAX_PLAYERS} players")
        # Anything overdue happens before the snapshot, so a player reconnecting to a
        # room nobody has looked at since a restart sees where it really is.
        await self.tick(code)
        room = await self.require_room(code)
        await self._touch(code, room.state)
        if outcome == "joined":
            await self.publish(code, {"type": "player_joined", "player": player.public()})
        else:
            await self.publish(
                code, {"type": "player_connection", "player_id": player.id, "connected": True}
            )
        return room

    async def mark_disconnected(self, code: str, player_id: str, conn: str) -> None:
        """Socket `conn` dropped. Only the player's current socket counts (ADR-031).
        During a race the slot is kept (§6); in lobby/finished the player is removed
        once the grace period has passed unless they come back."""
        now = _now()
        outcome = _text(
            await self._disconnect(keys=[self.players_key(code)], args=[player_id, conn, _ms(now)])
        )
        if outcome != "disconnected":
            return
        await self.publish(
            code, {"type": "player_connection", "player_id": player_id, "connected": False}
        )
        state = await self.redis.hget(self.room_key(code), "state")
        if state is None:
            return
        if _text(state) in (LOBBY, FINISHED):
            grace = self.settings.lobby_disconnect_grace_seconds
            self._wake_at(code, now + timedelta(seconds=grace))
        elif _text(state) == RUNNING:
            # If everyone still connected has already finished, don't wait for the timeout.
            await self._maybe_end_race(code)

    async def leave(self, code: str, player_id: str) -> None:
        if await self.redis.hdel(self.players_key(code), player_id):
            await self._after_removal(code, [player_id])

    async def _after_removal(self, code: str, removed: list[str]) -> None:
        """Announce departures, hand the host role on, delete an empty room."""
        for player_id in removed:
            await self.publish(code, {"type": "player_left", "player_id": player_id})
        room = await self.get_room(code)
        if room is None:
            return
        if not room.players:
            await self.redis.delete(*self._keys(code))
            return
        if room.host_id in removed:
            # Host handoff (§6): earliest-joined connected player, else earliest-joined.
            connected = [p for p in room.players if p.connected] or room.players
            new_host = min(connected, key=lambda p: p.joined_at)
            if await self._handoff(keys=[self.room_key(code)], args=[room.host_id, new_host.id]):
                await self.publish(code, {"type": "host_changed", "host_id": new_host.id})
        await self._touch(code, room.state)

    async def start(self, code: str, host_id: str) -> None:
        """Host pressed start: pick a text, then lobby -> countdown in one script."""
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
        # The checks above are for a clear error message; this is the one that counts.
        # Two `start` frames that both got this far (two tabs, a retry) race here, and
        # exactly one of them moves the room and announces a text.
        outcome = _text(
            await self._start(
                keys=self._keys(code),
                args=[host_id, str(text.id), text.content, _iso(starts_at), _ms(starts_at)],
            )
        )
        if outcome == "not_host":
            raise RoomError("not_host", "Only the host can start the race")
        if outcome == "wrong_state":
            raise RoomError("wrong_state", "The race is not in the lobby")
        if outcome == "no_room":
            raise RoomError("no_room", "Room not found or expired")
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
        self._wake_at(code, starts_at)

    # ---- transitions on a clock (ADR-031) --------------------------------------------

    async def tick(self, code: str) -> None:
        """Perform whatever transition is due. Safe to call any number of times from
        any number of places: every transition is a compare-and-set in Lua."""
        fields = await self.redis.hmget(
            self.room_key(code), ["state", "starts_at_ms", "deadline_ms", "race_id"]
        )
        state, starts_at_ms, deadline_ms, race_id = (
            _text(v) if v is not None else None for v in fields
        )
        if state is None:
            return
        now = _now()
        if state == COUNTDOWN and starts_at_ms is not None and int(starts_at_ms) <= _ms(now):
            await self._begin_race(code, now)
        elif (
            state == RUNNING
            and race_id is not None
            and deadline_ms is not None
            and int(deadline_ms) <= _ms(now)
        ):
            await self._end_race(code, race_id, now, force=False)
        elif state in (LOBBY, FINISHED):
            grace_ms = int(self.settings.lobby_disconnect_grace_seconds * 1000)
            removed = await self._sweep(keys=self._keys(code), args=[_ms(now), grace_ms])
            if removed:
                await self._after_removal(code, [_text(r) for r in removed])

    async def _begin_race(self, code: str, now: datetime) -> None:
        race_id = uuid.uuid4()
        deadline = now + timedelta(seconds=self.settings.race_max_seconds)
        won = await self._go(
            keys=[self.room_key(code)], args=[_ms(now), _iso(now), str(race_id), _ms(deadline)]
        )
        if not won:
            return
        room = await self.require_room(code)
        await self._ensure_race(room)
        await self._touch(code, RUNNING)
        await self.publish(code, {"type": "started", "started_at": _iso(now)})
        self._wake_at(code, deadline)

    async def _ensure_race(self, room: Room) -> None:
        """The `races` row for the room's current race; inserting it twice is a no-op.

        Written by whoever won the start transition, and again before anything that
        references it, so a replica that died between the Redis write and this one
        leaves nothing dangling."""
        if room.race_id is None or room.text_id is None or room.started_at is None:
            return
        async with self.session_factory() as db:
            await db.execute(
                insert(Race)
                .values(
                    id=uuid.UUID(room.race_id),
                    code=room.code,
                    language=Language(room.language),
                    difficulty=room.difficulty,
                    text_id=uuid.UUID(room.text_id),
                    started_at=_parse(room.started_at),
                )
                .on_conflict_do_nothing(index_elements=[Race.id])
            )
            await db.commit()

    async def progress(self, code: str, player_id: str, typed: int, errors: int) -> None:
        room = await self.get_room(code)
        if room is None or room.state != RUNNING or room.text_content is None:
            return
        # Display only, but it is the one number other players see: it cannot run past
        # the end of the text, and a player cannot have more errors than keystrokes.
        typed = min(max(0, typed), len(room.text_content))
        errors = min(max(0, errors), typed)
        updated = await self._patch_player(
            code, player_id, {"typed": typed, "errors": errors}, unfinished=True
        )
        if updated:
            await self.publish(
                code,
                {"type": "progress", "player_id": player_id, "typed": typed, "errors": errors},
            )

    async def finish(
        self, code: str, user: User, *, started_at: datetime, raw_keystrokes: list[list[object]]
    ) -> None:
        """Score the log exactly like practice (§5), then assign a place by arrival order."""
        await self.tick(code)  # a race past its deadline is over, not still running
        room = await self.require_room(code)
        player = next((p for p in room.players if p.id == str(user.id)), None)
        if room.state != RUNNING or room.race_id is None or room.started_at is None:
            raise RoomError("wrong_state", "The race is not running")
        if player is None:
            raise RoomError("not_in_room", "You are not in this room")
        if player.finished_at:
            raise RoomError("already_finished", "You already finished")
        await self._ensure_race(room)
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
        await self._patch_player(
            code,
            player.id,
            {
                "finished_at": _iso(now),
                "session_id": str(row.id),
                "place": place,
                "wpm": row.wpm,
                "accuracy": row.accuracy,
                "valid": row.is_valid,
                "typed": len(text.content_normalized),
            },
        )
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
        if await self.redis.hsetnx(self.room_key(code), "first_finish_at", _iso(now)):
            # Only the first finisher gets here: bring the deadline forward to the grace
            # period, unless the race's own limit comes sooner.
            grace_end = now + timedelta(seconds=self.settings.race_finish_grace_seconds)
            current = await self.redis.hget(self.room_key(code), "deadline_ms")
            deadline_ms = min(_ms(grace_end), int(current) if current else _ms(grace_end))
            await self.redis.hset(self.room_key(code), "deadline_ms", deadline_ms)
            self._wake_at(code, datetime.fromtimestamp(deadline_ms / 1000, tz=UTC))
        await self._maybe_end_race(code)

    async def _maybe_end_race(self, code: str) -> None:
        room = await self.get_room(code)
        if room is None or room.state != RUNNING or room.race_id is None:
            return
        still_typing = [p for p in room.players if p.connected and not p.finished_at]
        anyone_finished = any(p.finished_at for p in room.players)
        if anyone_finished and not still_typing:
            await self._end_race(code, room.race_id, _now(), force=True)

    async def _end_race(self, code: str, race_id: str, now: datetime, *, force: bool) -> None:
        """Freeze results (§5): unfinished players are DNF. The Lua compare-and-set
        means exactly one caller ends a given race, however many try."""
        won = await self._end(
            keys=[self.room_key(code)], args=[_ms(now), _iso(now), race_id, "1" if force else "0"]
        )
        if not won:
            return
        room = await self.require_room(code)  # read after the switch: includes the last finisher
        ordered = sorted(room.players, key=lambda p: (p.place is None, p.place or 0, p.joined_at))
        results = [
            {
                "player_id": p.id,
                "display_name": p.display_name,
                "place": p.place,
                "wpm": p.wpm,
                "accuracy": p.accuracy,
                "valid": p.valid,
                "dnf": p.finished_at is None,
            }
            for p in ordered
        ]
        await self._ensure_race(room)
        async with self.session_factory() as db:
            race = await db.get(Race, uuid.UUID(race_id))
            if race is not None:
                race.finished_at = now
                for p in room.players:
                    await db.execute(
                        insert(RaceResult)
                        .values(
                            race_id=race.id,
                            user_id=uuid.UUID(p.id),
                            session_id=uuid.UUID(p.session_id) if p.session_id else None,
                            place=p.place,
                        )
                        .on_conflict_do_nothing()
                    )
                await db.commit()
        await self._touch(code, FINISHED)
        await self.publish(code, {"type": "race_over", "results": results})

    async def play_again(self, code: str, host_id: str) -> None:
        outcome = _text(await self._play_again(keys=self._keys(code), args=[host_id]))
        if outcome == "no_room":
            raise RoomError("no_room", "Room not found or expired")
        if outcome == "not_host":
            raise RoomError("not_host", "Only the host can start another race")
        if outcome == "wrong_state":
            raise RoomError("wrong_state", "The race is not over yet")
        await self._touch(code, LOBBY)
        fresh = await self.require_room(code)
        await self.publish(code, fresh.snapshot())

    # ---- timers: latency only ----------------------------------------------------------

    def _wake_at(self, code: str, when: datetime) -> None:
        """Tick this room at `when`, so a transition lands on time rather than on the
        next relay tick. Losing this timer (a restart, another replica) only costs
        that delay."""
        self._schedule(self._tick_at(code, when))

    async def _tick_at(self, code: str, when: datetime) -> None:
        # A hair past the deadline, so the comparison in Lua sees it as due.
        await asyncio.sleep(max(0.0, (when - _now()).total_seconds()) + 0.01)
        try:
            await self.tick(code)
        except Exception:  # a timer is an optimisation; the next tick will retry
            log.exception("room %s: timed tick failed", code)

    def _schedule(self, coro: Coroutine[Any, Any, None]) -> None:
        """Fire-and-forget on this replica's loop; kept in a set so GC cannot cancel it."""
        task = asyncio.ensure_future(coro)
        self._timers.add(task)
        task.add_done_callback(self._timers.discard)

    async def close(self) -> None:
        for task in list(self._timers):
            task.cancel()
        await asyncio.gather(*self._timers, return_exceptions=True)
