"""The seed corpus obeys the corpus rules in docs/rtl-notes.md.

These run without a database: they check the sentences themselves.
"""

import re
from collections import Counter

import pytest

from app.i18n.normalize import normalize
from app.models.enums import Language
from app.schemas.text import CONTENT_MAX, CONTENT_MIN
from app.seeds import ENTRIES

PER_LEVEL = 10

# Characters a text in each language may contain: letters of its own script,
# a space, and punctuation that is on that language's standard keyboard.
_ALLOWED = {
    Language.EN: re.compile(r"^[A-Za-z\u00c0-\u017f .,;:!?'\"()\-]+$"),
    Language.HE: re.compile(r"^[א-ת .,:!?'\"()\-]+$"),
    Language.AR: re.compile(r"^[ء-ي ،؛؟.:!\"()\-]+$"),
}


def _by_language(language: Language) -> list[tuple[str, int]]:
    return [(text, level) for lang, text, level, _, _ in ENTRIES if lang is language]


@pytest.mark.parametrize("language", list(Language))
def test_every_language_has_ten_texts_per_level(language: Language) -> None:
    levels = Counter(level for _, level in _by_language(language))

    assert levels == {1: PER_LEVEL, 2: PER_LEVEL, 3: PER_LEVEL}


@pytest.mark.parametrize("language", list(Language))
def test_texts_are_already_normalized(language: Language) -> None:
    # What we ship is exactly what the player sees and types (ADR-013): no
    # niqqud, tashkeel, curly quotes or stray whitespace slipped in.
    for text, _ in _by_language(language):
        assert normalize(text, language) == text, text


@pytest.mark.parametrize("language", list(Language))
def test_texts_use_only_that_languages_keyboard(language: Language) -> None:
    # No digits, no Latin inside Hebrew/Arabic, no punctuation the layout lacks.
    for text, _ in _by_language(language):
        assert _ALLOWED[language].match(text), text


def test_no_duplicates_across_the_corpus() -> None:
    normalized = [normalize(text, lang) for lang, text, _, _, _ in ENTRIES]

    assert len(normalized) == len(set(normalized))


@pytest.mark.parametrize("language", list(Language))
def test_lengths_fit_the_schema_and_grow_with_difficulty(language: Language) -> None:
    texts = _by_language(language)
    for text, _ in texts:
        assert CONTENT_MIN <= len(text) <= CONTENT_MAX, text

    def average(level: int) -> float:
        lengths = [len(text) for text, lvl in texts if lvl == level]
        return sum(lengths) / len(lengths)

    assert average(1) < average(2) < average(3)


@pytest.mark.parametrize("language", list(Language))
def test_every_text_ends_with_sentence_punctuation(language: Language) -> None:
    for text, _ in _by_language(language):
        assert text[-1] in '.!?؟"', text
