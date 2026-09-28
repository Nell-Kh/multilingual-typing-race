"""Room transitions without the timers (ADR-031), at the service level.

The WebSocket tests in test_rooms.py cover the protocol. These drive RoomService
directly, because what they test is exactly what a socket cannot show: a second
service instance - a restarted process, or another replica - picking up a room
it never armed a timer for, and many callers racing for one transition.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import pytest
from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import cli
from app.core.settings import Settings
from app.models import Language, Race, RaceResult, User
from app.services import users
from app.services.rooms import COUNTDOWN, FINISHED, LOBBY, RUNNING, RoomError, RoomService

pytestmark = pytest.mark.db

COUNTDOWN_S = 0.2
RACE_MAX_S = 0.4


@dataclass
class World:
    redis: Redis
    factory: async_sessionmaker[AsyncSession]
    settings: Settings
    host: User
    guest: User

    def service(self) -> RoomService:
        """A fresh RoomService: a new process, with no timers of its own."""
        return RoomService(self.redis, self.factory, self.settings)


@pytest.fixture
async def world(database: str, redis_available: str) -> AsyncIterator[World]:
    engine = create_async_engine(database)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE race_results, races, session_key_stats, typing_sessions, "
                "texts, users CASCADE"
            )
        )
    await cli.seed_texts(database_url=database)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        host = await users.create_user(
            db, email="host@example.com", password="correct horse battery", display_name="H"
        )
        guest = await users.create_user(
            db, email="guest@example.com", password="correct horse battery", display_name="G"
        )
        await db.commit()
    redis = Redis.from_url(redis_available)
    await redis.flushdb()
    settings = Settings(
        app_env="test",
        database_url=database,
        redis_url=redis_available,
        race_countdown_seconds=COUNTDOWN_S,
        race_max_seconds=RACE_MAX_S,
    )
    try:
        yield World(redis, factory, settings, host, guest)
    finally:
        await redis.aclose()
        await engine.dispose()


async def _room_with_two(world: World, svc: RoomService) -> str:
    room = await svc.create_room(world.host, language=Language.HE, difficulty=1)
    await svc.join(room.code, world.host, conn="h1")
    await svc.join(room.code, world.guest, conn="g1")
    return room.code


async def _state(world: World, code: str) -> str:
    raw = await world.redis.hget(f"room:{code}", "state")
    assert isinstance(raw, bytes)
    return raw.decode()


async def _count(world: World, model: Any) -> int:
    async with world.factory() as db:
        return int(await db.scalar(select(func.count()).select_from(model)) or 0)


async def _collect(world: World, code: str) -> tuple[Any, list[dict[str, Any]]]:
    """Subscribe to a room's events; returns the pubsub and the list it fills."""
    pubsub = world.redis.pubsub()
    await pubsub.subscribe(f"room:{code}:events")
    # Wait for the confirmation, so the subscription is live before anyone publishes.
    confirmed = await pubsub.get_message(timeout=1.0)
    assert confirmed is not None and confirmed["type"] == "subscribe"
    return pubsub, []


async def _drain(pubsub: Any, into: list[dict[str, Any]]) -> list[dict[str, Any]]:
    while (m := await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)) is not None:
        into.append(json.loads(m["data"]))
    await pubsub.aclose()
    return into


async def test_a_new_process_carries_a_room_through_countdown_and_the_deadline(
    world: World,
) -> None:
    before = world.service()
    code = await _room_with_two(world, before)
    await before.start(code, str(world.host.id))
    await before.close()  # the process that armed the timers goes away
    assert await _state(world, code) == COUNTDOWN

    after = world.service()  # a restart, or another replica
    await asyncio.sleep(COUNTDOWN_S + 0.05)
    await after.tick(code)
    assert await _state(world, code) == RUNNING
    assert await _count(world, Race) == 1

    await after.close()  # drop the deadline timer too; only ticks remain
    await asyncio.sleep(RACE_MAX_S + 0.05)
    await world.service().tick(code)
    assert await _state(world, code) == FINISHED
    async with world.factory() as db:
        race = (await db.scalars(select(Race))).one()
        assert race.finished_at is not None
    assert await _count(world, RaceResult) == 2  # both players, both did not finish


async def test_a_tick_before_the_deadline_changes_nothing(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)
    await svc.start(code, str(world.host.id))
    await svc.close()

    await world.service().tick(code)  # countdown is still running

    assert await _state(world, code) == COUNTDOWN
    assert await _count(world, Race) == 0


async def test_many_ticks_at_once_make_one_transition(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)
    await svc.start(code, str(world.host.id))
    await svc.close()
    pubsub, events = await _collect(world, code)
    await asyncio.sleep(COUNTDOWN_S + 0.05)

    # Five replicas, each with a socket in the room, all tick in the same instant.
    await asyncio.gather(*(world.service().tick(code) for _ in range(5)))

    kinds = [e["type"] for e in await _drain(pubsub, events)]
    assert kinds.count("started") == 1
    assert await _count(world, Race) == 1


async def test_two_starts_at_once_make_one_countdown(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)
    pubsub, events = await _collect(world, code)

    outcomes = await asyncio.gather(
        svc.start(code, str(world.host.id)),
        world.service().start(code, str(world.host.id)),
        return_exceptions=True,
    )

    refused = [o for o in outcomes if isinstance(o, RoomError)]
    assert len(refused) == 1 and refused[0].code == "wrong_state"
    countdowns = [e for e in await _drain(pubsub, events) if e["type"] == "countdown"]
    assert len(countdowns) == 1
    stored = await world.redis.hget(f"room:{code}", "text_id")
    assert isinstance(stored, bytes) and stored.decode() == countdowns[0]["text"]["id"]
    await svc.close()


async def test_play_again_twice_resets_once(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)
    await svc.start(code, str(world.host.id))
    await asyncio.sleep(COUNTDOWN_S + 0.05)
    await svc.tick(code)
    await asyncio.sleep(RACE_MAX_S + 0.05)
    await svc.tick(code)
    assert await _state(world, code) == FINISHED

    outcomes = await asyncio.gather(
        svc.play_again(code, str(world.host.id)),
        svc.play_again(code, str(world.host.id)),
        return_exceptions=True,
    )

    assert sum(isinstance(o, RoomError) for o in outcomes) == 1
    assert await _state(world, code) == LOBBY
    await svc.close()


async def test_a_disconnect_from_an_old_connection_is_ignored(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)
    await svc.join(code, world.host, conn="h2")  # second tab takes over

    await svc.mark_disconnected(code, str(world.host.id), "h1")  # the first tab closes

    host = await svc.get_player(code, str(world.host.id))
    assert host is not None and host.connected is True and host.conn == "h2"
    await svc.mark_disconnected(code, str(world.host.id), "h2")
    host = await svc.get_player(code, str(world.host.id))
    assert host is not None and host.connected is False
    await svc.close()


async def test_connection_ids_are_not_shown_to_other_players(world: World) -> None:
    svc = world.service()
    code = await _room_with_two(world, svc)

    room = await svc.require_room(code)

    for player in room.snapshot()["players"]:
        assert "conn" not in player and "disconnected_at_ms" not in player
    assert uuid.UUID(room.host_id)
    await svc.close()
