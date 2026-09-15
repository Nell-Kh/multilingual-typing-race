from enum import StrEnum


class Language(StrEnum):
    """The three supported languages. Stored as the two-letter code."""

    HE = "he"
    AR = "ar"
    EN = "en"


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"
