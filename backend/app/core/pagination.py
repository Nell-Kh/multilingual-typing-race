"""Keyset ("cursor") pagination.

Offset pagination (`?page=7`) gets slower the deeper you go and skips or repeats
rows when data changes between requests. A keyset cursor instead says "continue
after the row with (created_at, id) = X": constant cost, stable under inserts.
The cursor is opaque to clients — base64 of the two values — so its format can
change without breaking anyone.
"""

import base64
import binascii
import uuid
from datetime import datetime

from pydantic import BaseModel, ValidationError

from app.core.errors import ApiError

DEFAULT_LIMIT, MAX_LIMIT = 20, 100


class Cursor(BaseModel):
    created_at: datetime
    id: uuid.UUID

    def encode(self) -> str:
        raw = f"{self.created_at.isoformat()}|{self.id}".encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(value: str | None) -> Cursor | None:
    if value is None:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        created_at, id_ = base64.urlsafe_b64decode(padded).decode().split("|", 1)
        return Cursor(created_at=datetime.fromisoformat(created_at), id=uuid.UUID(id_))
    except (binascii.Error, UnicodeDecodeError, ValueError, ValidationError) as exc:
        raise ApiError(400, "invalid_cursor", "Cursor is malformed") from exc
