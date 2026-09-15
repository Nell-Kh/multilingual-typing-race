import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import Language

CONTENT_MIN, CONTENT_MAX = 10, 2000


class TextOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    language: Language
    content: str
    char_count: int
    difficulty: int
    source: str
    license: str
    is_active: bool
    created_at: datetime


class TextCreate(BaseModel):
    language: Language
    content: str = Field(min_length=CONTENT_MIN, max_length=CONTENT_MAX)
    difficulty: int = Field(ge=1, le=3)
    source: str = Field(min_length=1, max_length=255)
    license: str = Field(min_length=1, max_length=100)

    @field_validator("content")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value


class TextUpdate(BaseModel):
    """Every field optional: send only what changes."""

    content: str | None = Field(default=None, min_length=CONTENT_MIN, max_length=CONTENT_MAX)
    difficulty: int | None = Field(default=None, ge=1, le=3)
    source: str | None = Field(default=None, min_length=1, max_length=255)
    license: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None


class TextPage(BaseModel):
    items: list[TextOut]
    next_cursor: str | None
