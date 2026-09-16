import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import Language, SessionMode


def _enum(enum_cls: type[Language] | type[SessionMode], name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        values_callable=lambda e: [m.value for m in e],
    )


class TypingSession(Base):
    """One completed typing attempt. Every number here is computed by the server
    from `keystrokes`; nothing numeric is ever trusted from the client."""

    __tablename__ = "typing_sessions"
    __table_args__ = (
        CheckConstraint("duration_ms > 0", name="duration_positive"),
        CheckConstraint("accuracy BETWEEN 0 AND 100", name="accuracy_range"),
        # "my history" and "leaderboard" queries (see brief §5).
        Index("ix_typing_sessions_user_id_started_at", "user_id", "started_at"),
        Index("ix_typing_sessions_language_is_valid_wpm", "language", "is_valid", "wpm"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    text_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("texts.id", ondelete="RESTRICT"))
    mode: Mapped[SessionMode] = mapped_column(_enum(SessionMode, "session_mode"))
    # Races arrive in M4; the FK is added by that migration.
    race_id: Mapped[uuid.UUID | None]
    language: Mapped[Language] = mapped_column(_enum(Language, "language"))

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int] = mapped_column(Integer)

    wpm: Mapped[float] = mapped_column(Float)
    cpm: Mapped[float] = mapped_column(Float)
    raw_wpm: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float] = mapped_column(Float)  # percent, 0-100
    error_count: Mapped[int] = mapped_column(Integer)
    keystroke_count: Mapped[int] = mapped_column(Integer)

    is_valid: Mapped[bool]
    invalid_reason: Mapped[str | None] = mapped_column(String(64))
    # Raw log [[t_ms, expected, typed], ...]; pruned to NULL after 30 days by a cron job (M5).
    keystrokes: Mapped[list[Any] | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    key_stats: Mapped[list["SessionKeyStat"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class SessionKeyStat(Base):
    """Per-key aggregate for one session: what the keyboard heatmap reads."""

    __tablename__ = "session_key_stats"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("typing_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    key_char: Mapped[str] = mapped_column(String(8), primary_key=True)
    correct_count: Mapped[int] = mapped_column(Integer)
    error_count: Mapped[int] = mapped_column(Integer)
    avg_latency_ms: Mapped[float | None] = mapped_column(Float)

    session: Mapped[TypingSession] = relationship(back_populates="key_stats")
