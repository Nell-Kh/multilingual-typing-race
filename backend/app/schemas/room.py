from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import Language


class RoomCreate(BaseModel):
    language: Language
    difficulty: int = Field(ge=1, le=3)


class PlayerOut(BaseModel):
    id: str
    display_name: str
    connected: bool
    typed: int
    errors: int
    finished_at: str | None
    place: int | None
    wpm: float | None
    accuracy: float | None
    valid: bool | None


class RoomOut(BaseModel):
    """The HTTP view of a room: enough to show a join screen (docs/race-protocol.md §3)."""

    code: str
    state: str
    host_id: str
    language: Language
    difficulty: int
    players: list[PlayerOut]

    @classmethod
    def from_snapshot(cls, snapshot: dict[str, Any]) -> "RoomOut":
        return cls(
            code=snapshot["code"],
            state=snapshot["state"],
            host_id=snapshot["host_id"],
            language=snapshot["language"],
            difficulty=snapshot["difficulty"],
            players=[PlayerOut(**p) for p in snapshot["players"]],
        )
