import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import SessionDep
from app.core.errors import ApiError
from app.models import Language
from app.schemas.text import TextOut
from app.services import texts

router = APIRouter(prefix="/texts", tags=["texts"])


@router.get("/random")
async def random_text(
    session: SessionDep,
    lang: Language,
    difficulty: Annotated[int | None, Query(ge=1, le=3)] = None,
) -> TextOut:
    text = await texts.random_text(session, language=lang, difficulty=difficulty)
    if text is None:
        raise ApiError(404, "not_found", "No text available for that language and difficulty")
    return TextOut.model_validate(text)


@router.get("/{text_id}")
async def get_text(session: SessionDep, text_id: uuid.UUID) -> TextOut:
    text = await texts.get_text(session, text_id)
    if text is None or not text.is_active:
        raise ApiError(404, "not_found", "Text not found")
    return TextOut.model_validate(text)
