import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.core.deps import AdminUser, SessionDep
from app.core.errors import ApiError
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Cursor, decode_cursor
from app.models import Language, Text
from app.schemas.text import TextCreate, TextOut, TextPage, TextUpdate
from app.services import texts

router = APIRouter(prefix="/admin/texts", tags=["admin"])


async def _load(session: SessionDep, text_id: uuid.UUID) -> Text:
    text = await texts.get_text(session, text_id)
    if text is None:
        raise ApiError(404, "not_found", "Text not found")
    return text


@router.get("")
async def list_texts(
    session: SessionDep,
    _: AdminUser,
    lang: Language | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> TextPage:
    # Ask for one extra row: if it comes back, there is a next page.
    rows = await texts.list_texts(
        session, language=lang, limit=limit + 1, after=decode_cursor(cursor)
    )
    page, has_more = rows[:limit], len(rows) > limit
    next_cursor = (
        Cursor(created_at=page[-1].created_at, id=page[-1].id).encode() if has_more else None
    )
    return TextPage(items=[TextOut.model_validate(t) for t in page], next_cursor=next_cursor)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_text(session: SessionDep, admin: AdminUser, body: TextCreate) -> TextOut:
    text = await texts.create_text(
        session,
        language=body.language,
        content=body.content,
        difficulty=body.difficulty,
        source=body.source,
        license=body.license,
        created_by=admin.id,
    )
    return TextOut.model_validate(text)


@router.put("/{text_id}")
async def update_text(
    session: SessionDep, _: AdminUser, text_id: uuid.UUID, body: TextUpdate
) -> TextOut:
    text = await _load(session, text_id)
    updated = await texts.update_text(session, text, **body.model_dump(exclude_unset=True))
    return TextOut.model_validate(updated)


@router.delete("/{text_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_text(session: SessionDep, _: AdminUser, text_id: uuid.UUID) -> None:
    await texts.deactivate_text(session, await _load(session, text_id))
