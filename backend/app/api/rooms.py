"""Race rooms over HTTP (create, preview) and WebSocket (everything live).

The frames are defined in docs/race-protocol.md §4. This module only parses and
routes them; the rules live in app/services/rooms.py.
"""

import asyncio
import contextlib
import json
import logging
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError
from redis.asyncio.client import PubSub

from app.core.deps import CurrentUser
from app.core.errors import ApiError
from app.core.security import InvalidTokenError, TokenType, decode_token
from app.models import User
from app.schemas.room import RoomCreate, RoomOut
from app.schemas.session import MAX_KEYSTROKES
from app.services import users
from app.services.rooms import PROGRESS_MIN_INTERVAL, RoomError, RoomService

log = logging.getLogger(__name__)
router = APIRouter(prefix="/rooms", tags=["rooms"])

# WebSocket close codes (4xxx is the application range).
WS_UNAUTHORIZED = 4401
WS_BAD_FRAME = 4400
WS_REJECTED = 4409


def get_rooms(request: Request) -> RoomService:
    rooms: RoomService = request.app.state.rooms
    return rooms


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(body: RoomCreate, user: CurrentUser, request: Request) -> RoomOut:
    rooms = get_rooms(request)
    room = await rooms.create_room(user, language=body.language, difficulty=body.difficulty)
    return RoomOut.from_snapshot(room.snapshot())


@router.get("/{code}")
async def preview_room(code: str, request: Request) -> RoomOut:
    room = await get_rooms(request).get_room(code.upper())
    if room is None:
        raise ApiError(404, "not_found", "Room not found or expired")
    return RoomOut.from_snapshot(room.snapshot())


# ---- WebSocket frames (client -> server), validated with pydantic --------------


class AuthFrame(BaseModel):
    token: str


class ProgressFrame(BaseModel):
    typed: int = Field(ge=0)
    errors: int = Field(ge=0)


class FinishFrame(BaseModel):
    started_at: datetime
    keystrokes: list[list[object]] = Field(min_length=1, max_length=MAX_KEYSTROKES)


async def _authenticate(websocket: WebSocket, auth_timeout: float) -> User | None:
    """First frame must be `auth` (§3). Returns the user, or None after closing."""
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=auth_timeout)
        frame = AuthFrame(**raw) if raw.get("type") == "auth" else None
    except (TimeoutError, ValidationError, ValueError, AttributeError):
        frame = None
    except WebSocketDisconnect:
        return None
    if frame is None:
        await websocket.close(code=WS_UNAUTHORIZED, reason="auth frame expected")
        return None
    try:
        claims = decode_token(frame.token, TokenType.ACCESS)
    except InvalidTokenError:
        await websocket.close(code=WS_UNAUTHORIZED, reason="invalid token")
        return None
    factory = websocket.app.state.session_factory
    async with factory() as db:
        user = await users.get_user(db, claims.sub)
    if user is None:
        await websocket.close(code=WS_UNAUTHORIZED, reason="unknown user")
    return user


async def _relay(pubsub: PubSub, websocket: WebSocket) -> None:
    """Forward every event published for this room to this socket (§7)."""
    async for message in pubsub.listen():
        if message["type"] == "message":
            await websocket.send_text(message["data"].decode())


async def _send_error(websocket: WebSocket, code: str, message: str) -> None:
    await websocket.send_json({"type": "error", "code": code, "message": message})


@router.websocket("/{code}/ws")
async def room_socket(websocket: WebSocket, code: str) -> None:
    code = code.upper()
    rooms: RoomService = websocket.app.state.rooms
    settings = websocket.app.state.settings
    await websocket.accept()

    user = await _authenticate(websocket, settings.ws_auth_timeout_seconds)
    if user is None:
        return
    player_id = str(user.id)

    # Subscribe *before* joining so no event between join and snapshot is missed,
    # but only start forwarding *after* the snapshot: the reply to `auth` must be
    # the `room` frame (§3), never an event that raced ahead of it.
    pubsub = rooms.redis.pubsub()
    await pubsub.subscribe(rooms.channel(code))
    try:
        room = await rooms.join(code, user)
    except RoomError as exc:
        await pubsub.aclose()  # type: ignore[no-untyped-call]
        await _send_error(websocket, exc.code, exc.message)
        await websocket.close(code=WS_REJECTED, reason=exc.code)
        return
    await websocket.send_json(room.snapshot())
    relay = asyncio.create_task(_relay(pubsub, websocket))
    last_progress = 0.0
    try:
        while True:
            try:
                raw: Any = await websocket.receive_json()
            except (json.JSONDecodeError, ValueError):
                await websocket.close(code=WS_BAD_FRAME, reason="malformed frame")
                break
            kind = raw.get("type") if isinstance(raw, dict) else None
            try:
                if kind == "start":
                    await rooms.start(code, player_id)
                elif kind == "progress":
                    now = time.monotonic()
                    if now - last_progress >= PROGRESS_MIN_INTERVAL:
                        last_progress = now
                        frame = ProgressFrame(**raw)
                        await rooms.progress(code, player_id, frame.typed, frame.errors)
                elif kind == "finish":
                    finish = FinishFrame(**raw)
                    await rooms.finish(
                        code, user, started_at=finish.started_at, raw_keystrokes=finish.keystrokes
                    )
                elif kind == "play_again":
                    await rooms.play_again(code, player_id)
                elif kind == "leave":
                    await rooms.leave(code, player_id)
                    break
                # Unknown types are ignored on purpose (§3): forward compatibility.
            except RoomError as exc:
                await _send_error(websocket, exc.code, exc.message)
            except ValidationError as exc:
                await _send_error(websocket, "bad_frame", exc.errors()[0]["msg"])
    except WebSocketDisconnect:
        pass
    finally:
        relay.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await relay
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]
        player = await rooms.get_player(code, player_id)
        if player is not None and player.connected:
            await rooms.mark_disconnected(code, player_id)
