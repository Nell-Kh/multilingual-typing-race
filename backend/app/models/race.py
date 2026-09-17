import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Language
from app.models.session import _enum


class Race(Base):
    """One run of one text in a room. Live state lives in Redis (docs/race-protocol.md §7);
    this row is written when the race starts and completed when it ends."""

    __tablename__ = "races"
    __table_args__ = (CheckConstraint("difficulty BETWEEN 1 AND 3", name="difficulty_range"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    code: Mapped[str] = mapped_column(String(6))
    language: Mapped[Language] = mapped_column(_enum(Language, "language"))
    difficulty: Mapped[int] = mapped_column(SmallInteger)
    text_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("texts.id", ondelete="RESTRICT"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    results: Mapped[list["RaceResult"]] = relationship(
        back_populates="race", cascade="all, delete-orphan"
    )


class RaceResult(Base):
    """Who raced and where they placed. `place` is NULL for did-not-finish and for
    logs the validator rejected; `session_id` is NULL only for did-not-finish."""

    __tablename__ = "race_results"
    __table_args__ = (CheckConstraint("place IS NULL OR place >= 1", name="place_positive"),)

    race_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("races.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("typing_sessions.id", ondelete="SET NULL")
    )
    place: Mapped[int | None] = mapped_column(Integer)

    race: Mapped[Race] = relationship(back_populates="results")
