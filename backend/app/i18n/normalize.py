"""Text normalization: turns authored text into the exact string a player types.

Every text is normalized once at import (`content` and `content_normalized` both
hold the result, see ADR-013) and the validator replays keystrokes against it.
The rule of thumb: *what you see is what you type*, and nothing you cannot
type on a standard keyboard survives normalization.

Shared rules (all languages)
    * NFKC: composes accents ("e" + U+0301 -> "é") and unfolds compatibility
      forms such as Arabic presentation forms (U+FE70..U+FEFF) and the ellipsis "…" -> "...".
    * Invisible formatting characters are dropped (zero-width joiners, bidi
      marks, BOM): they are untypeable and would make a text unfinishable.
    * Curly quotes, guillemets and typographic dashes become their ASCII keys.
    * Whitespace runs collapse to one space; leading/trailing whitespace goes.

Hebrew
    * Niqqud and cantillation marks (U+0591..U+05C7, category Mn) are stripped:
      our texts are unpointed, and the SI-1452 keyboard cannot type them anyway.
    * Geresh (U+05F3) -> "'", gershayim (U+05F4) -> '"', maqaf (U+05BE) -> "-",
      sof pasuq (U+05C3) -> ":": the keyboard has the ASCII keys, not these.
    * Yiddish ligatures (U+05F0..U+05F2) -> the two letters they stand for.
    * Final letters are NOT folded: "ך" and "כ" are different keys, so typing
      the wrong form is a real mistake.

Arabic
    * Tashkeel (fatha, damma, kasra, shadda, sukun, tanwin, ...), the
      superscript alef (U+0670) and Quranic annotation marks are stripped.
    * Tatweel/kashida (U+0640) is stripped: it is decoration, not a letter.
    * Alef wasla (U+0671) -> "ا": it only appears in Quranic orthography.
    * Persian/Urdu look-alikes that leak in from copied text are mapped to the
      Arabic letters on the keyboard: "ک" (U+06A9) -> "ك", "ی" (U+06CC) -> "ي",
      "ھ" (U+06BE) -> "ه".
    * Punctuation is Arabic: ASCII "," ";" "?" become "،" "؛" "؟", which is
      what the Arabic 101 keyboard produces (Shift+K, Shift+P, Shift+/) and
      how Arabic is written. "." "!" ":" are shared with ASCII and stay.
    * Letters are matched strictly: "أ" != "ا", "ة" != "ه", "ى" != "ي".
      They are separate keys and confusing them is a spelling mistake.

Full discussion and the keyboard maps: docs/rtl-notes.md.
"""

import re
import unicodedata

from app.models.enums import Language

# Code point ranges whose combining marks (category Mn) we strip, per language.
_HEBREW_BLOCK = range(0x0590, 0x0600)
_ARABIC_BLOCKS = (
    range(0x0600, 0x0700),  # Arabic
    range(0x0750, 0x0780),  # Arabic Supplement
    range(0x08A0, 0x0900),  # Arabic Extended-A/B
)
# Invisible characters that never survive: zero-width (non-)joiner, bidi marks,
# Arabic letter mark, word joiner, BOM / zero-width no-break space.
_INVISIBLE = re.compile("[\u200b\u200c\u200d\u200e\u200f\u061c\u2060\ufeff]")

_WHITESPACE = re.compile(r"\s+")

# Typographic punctuation -> the key a typist actually presses.
_COMMON_PUNCTUATION = {
    "\u2018": "'",  # ‘ left single quote
    "\u2019": "'",  # ’ right single quote / apostrophe
    "\u201a": "'",  # ‚ low single quote
    "\u201c": '"',  # “ left double quote
    "\u201d": '"',  # ” right double quote
    "\u201e": '"',  # „ low double quote
    "\u00ab": '"',  # « guillemet
    "\u00bb": '"',  # » guillemet
    "\u2013": "-",  # – en dash
    "\u2014": "-",  # — em dash
    "\u2212": "-",  # − minus sign
}
_HEBREW_ONLY = {
    "\u05f3": "'",  # ׳ geresh
    "\u05f4": '"',  # ״ gershayim
    "\u05be": "-",  # ־ maqaf
    "\u05c3": ":",  # ׃ sof pasuq
    "\u05f0": "\u05d5\u05d5",  # װ -> וו
    "\u05f1": "\u05d5\u05d9",  # ױ -> וי
    "\u05f2": "\u05d9\u05d9",  # ײ -> יי
}
_ARABIC_ONLY = {
    ",": "\u060c",  # ،
    ";": "\u061b",  # ؛
    "?": "\u061f",  # ؟
    "\u0671": "\u0627",  # ٱ alef wasla -> ا
    "\u06a9": "\u0643",  # ک Persian kaf -> ك
    "\u06cc": "\u064a",  # ی Persian yeh -> ي
    "\u06be": "\u0647",  # ھ Urdu heh -> ه
    "\u0640": "",  # ـ tatweel
}

# One translation table per language; str.translate applies it in a single pass.
_TABLES: dict[Language, dict[int, str]] = {
    Language.EN: str.maketrans(_COMMON_PUNCTUATION),
    Language.HE: str.maketrans({**_COMMON_PUNCTUATION, **_HEBREW_ONLY}),
    Language.AR: str.maketrans({**_COMMON_PUNCTUATION, **_ARABIC_ONLY}),
}


def _in_blocks(char: str, blocks: tuple[range, ...]) -> bool:
    code = ord(char)
    return any(code in block for block in blocks)


def _strip_marks(text: str, blocks: tuple[range, ...]) -> str:
    """Drop combining marks (niqqud / tashkeel) that sit inside the given blocks."""
    return "".join(
        ch for ch in text if not (unicodedata.category(ch) == "Mn" and _in_blocks(ch, blocks))
    )


def normalize(text: str, language: Language) -> str:
    """Return the typing target for `text` (see the module docstring for the rules)."""
    result = unicodedata.normalize("NFKC", text)
    result = _INVISIBLE.sub("", result)
    if language is Language.HE:
        result = _strip_marks(result, (_HEBREW_BLOCK,))
    elif language is Language.AR:
        result = _strip_marks(result, _ARABIC_BLOCKS)
    result = result.translate(_TABLES[language])
    return _WHITESPACE.sub(" ", result).strip()
