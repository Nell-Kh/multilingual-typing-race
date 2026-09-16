"""Text corpus: reads for players, writes for admins, and the seed importer."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import Cursor
from app.i18n.normalize import normalize
from app.models import Language, Text


async def random_text(
    session: AsyncSession, *, language: Language, difficulty: int | None = None
) -> Text | None:
    # ORDER BY random() scans every matching row; fine for a corpus of hundreds.
    # Revisit (e.g. TABLESAMPLE or id-range tricks) if it ever reaches millions.
    stmt = select(Text).where(Text.language == language, Text.is_active.is_(True))
    if difficulty is not None:
        stmt = stmt.where(Text.difficulty == difficulty)
    text: Text | None = await session.scalar(stmt.order_by(func.random()).limit(1))
    return text


async def get_text(session: AsyncSession, text_id: uuid.UUID) -> Text | None:
    return await session.get(Text, text_id)


async def list_texts(
    session: AsyncSession,
    *,
    language: Language | None,
    limit: int,
    after: Cursor | None,
) -> Sequence[Text]:
    """Newest first. Returns up to `limit` rows strictly after the cursor."""
    stmt = select(Text)
    if language is not None:
        stmt = stmt.where(Text.language == language)
    if after is not None:
        # Row-value comparison: everything that sorts after the cursor row.
        stmt = stmt.where(tuple_(Text.created_at, Text.id) < (after.created_at, after.id))
    stmt = stmt.order_by(Text.created_at.desc(), Text.id.desc()).limit(limit)
    return (await session.scalars(stmt)).all()


def _apply_content(text: Text, content: str) -> None:
    # What you see is what you type (ADR-013): the display text *is* the typing
    # target, so both columns hold the normalized form.
    text.content_normalized = normalize(content, text.language)
    text.content = text.content_normalized
    text.char_count = len(text.content_normalized)


async def create_text(
    session: AsyncSession,
    *,
    language: Language,
    content: str,
    difficulty: int,
    source: str,
    license: str,
    created_by: uuid.UUID | None,
) -> Text:
    text = Text(
        language=language,
        difficulty=difficulty,
        source=source,
        license=license,
        created_by=created_by,
        content="",
        content_normalized="",
        char_count=1,
    )
    _apply_content(text, content)
    session.add(text)
    await session.commit()
    await session.refresh(text)
    return text


async def update_text(
    session: AsyncSession,
    text: Text,
    *,
    content: str | None = None,
    difficulty: int | None = None,
    source: str | None = None,
    license: str | None = None,
    is_active: bool | None = None,
) -> Text:
    if content is not None:
        _apply_content(text, content)
    if difficulty is not None:
        text.difficulty = difficulty
    if source is not None:
        text.source = source
    if license is not None:
        text.license = license
    if is_active is not None:
        text.is_active = is_active
    await session.commit()
    await session.refresh(text)
    return text


async def deactivate_text(session: AsyncSession, text: Text) -> None:
    """Soft delete: typing sessions will reference texts, so rows are never removed."""
    text.is_active = False
    await session.commit()


async def upsert_seed(
    session: AsyncSession, entries: list[tuple[Language, str, int, str, str]]
) -> int:
    """Insert seed texts that aren't already present (matched on normalized content)."""
    existing = set((await session.scalars(select(Text.content_normalized))).all())
    added = 0
    for language, content, difficulty, source, license in entries:
        normalized = normalize(content, language)
        if normalized in existing:
            continue
        session.add(
            Text(
                language=language,
                content=normalized,
                content_normalized=normalized,
                char_count=len(normalized),
                difficulty=difficulty,
                source=source,
                license=license,
            )
        )
        existing.add(normalized)
        added += 1
    await session.commit()
    return added
