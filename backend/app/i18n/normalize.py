"""Text normalization: what the validator compares typed input against.

`content` is what we display; `normalize(content)` is what we store as
`content_normalized` and compare keystrokes to. M1 ships the English rules and a
safe baseline for Hebrew/Arabic; M3 adds niqqud/tashkeel stripping and the
final-letter and quote rules (see docs/rtl-notes.md when it exists).
"""

import re
import unicodedata

from app.models.enums import Language

_CURLY_QUOTES = str.maketrans(
    {
        "‘": "'",  # ‘
        "’": "'",  # ’
        "“": '"',  # “
        "”": '"',  # ”
        "–": "-",  # – en dash
        "—": "-",  # — em dash
        "…": "...",  # …
    }
)
_WHITESPACE = re.compile(r"\s+")


def normalize(text: str, language: Language) -> str:
    """NFC, collapsed whitespace, and (for English) ASCII punctuation only."""
    result = unicodedata.normalize("NFC", text)
    result = _WHITESPACE.sub(" ", result).strip()
    if language is Language.EN:
        result = result.translate(_CURLY_QUOTES)
    return result
