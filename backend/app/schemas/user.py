import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import Language, UserRole


class UserOut(BaseModel):
    """What the API says about a user. Never includes the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: UserRole
    preferred_language: Language
    created_at: datetime
