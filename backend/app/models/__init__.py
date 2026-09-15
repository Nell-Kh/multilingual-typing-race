"""SQLAlchemy models.

Importing every model here means `Base.metadata` is complete as soon as this
package is imported — which is what Alembic relies on to see the full schema.
"""

from app.models.enums import Language, UserRole
from app.models.text import Text
from app.models.user import User

__all__ = ["Language", "Text", "User", "UserRole"]
