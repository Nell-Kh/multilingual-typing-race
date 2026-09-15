"""User creation and credential checks. Routes call these; so will the seed script."""

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models import User, UserRole


class EmailTakenError(Exception):
    pass


async def create_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    display_name: str,
    role: UserRole = UserRole.USER,
) -> User:
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        display_name=display_name,
        role=role,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        # The unique index is the real guard: two simultaneous registrations with
        # the same email can't both pass a SELECT-then-INSERT check.
        await session.rollback()
        raise EmailTakenError(email) from exc
    await session.refresh(user)
    return user


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User | None:
    """The user if the credentials match, else None. Unknown email and wrong password
    are deliberately indistinguishable to the caller."""
    user = await session.scalar(select(User).where(User.email == email.lower()))
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)
