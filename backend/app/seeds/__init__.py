"""The seed corpus: original CC0 sentences in every supported language."""

from app.models.enums import Language
from app.seeds import ar, en, he

ENTRIES: list[tuple[Language, str, int, str, str]] = [*en.ENTRIES, *he.ENTRIES, *ar.ENTRIES]

__all__ = ["ENTRIES", "ar", "en", "he"]
