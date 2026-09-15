import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import Language


class Text(Base):
    """One passage a user can type. Seeded or created by an admin."""

    __tablename__ = "texts"
    __table_args__ = (
        CheckConstraint("char_count > 0", name="char_count_positive"),
        CheckConstraint("difficulty BETWEEN 1 AND 3", name="difficulty_range"),
        # Covers the "give me a random active text in this language" query.
        Index("ix_texts_language_difficulty_is_active", "language", "difficulty", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    language: Mapped[Language] = mapped_column(
        Enum(
            Language,
            name="language",
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        )
    )
    # What we show the user, diacritics and all.
    content: Mapped[str] = mapped_column(sa.Text)
    # What the validator compares typed input against (see docs/rtl-notes.md, M3).
    content_normalized: Mapped[str] = mapped_column(sa.Text)
    char_count: Mapped[int]
    difficulty: Mapped[int] = mapped_column(SmallInteger)
    source: Mapped[str] = mapped_column(String(255))
    license: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<Text {self.language} d{self.difficulty} {self.char_count} chars>"
