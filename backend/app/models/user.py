import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import Language, UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    # Always stored lower-cased, so the unique index is effectively case-insensitive.
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(50))
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=UserRole.USER,
        server_default=UserRole.USER.value,
    )
    preferred_language: Mapped[Language] = mapped_column(
        Enum(
            Language,
            name="language",
            native_enum=False,
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=Language.EN,
        server_default=Language.EN.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<User {self.email}>"
