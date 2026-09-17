"""SQLAlchemy models.

Importing every model here means `Base.metadata` is complete as soon as this
package is imported — which is what Alembic relies on to see the full schema.
"""

from app.models.enums import Language, SessionMode, UserRole
from app.models.race import Race, RaceResult
from app.models.session import SessionKeyStat, TypingSession
from app.models.text import Text
from app.models.user import User

__all__ = [
    "Language",
    "Race",
    "RaceResult",
    "SessionKeyStat",
    "SessionMode",
    "Text",
    "TypingSession",
    "User",
    "UserRole",
]
