"""Normalization rules (see app/i18n/normalize.py and docs/rtl-notes.md).

Combining marks are written as \\u escapes so the expectations stay readable in
any editor; the letters themselves are written as letters.
"""

import pytest

from app.i18n.normalize import normalize
from app.models.enums import Language

ALL_LANGUAGES = [Language.EN, Language.HE, Language.AR]


# --- shared rules -----------------------------------------------------------


@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_whitespace_is_collapsed(language: Language) -> None:
    assert normalize("  two   words\n\tand more  ", language) == "two words and more"


@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_curly_quotes_and_dashes_become_ascii(language: Language) -> None:
    assert normalize("\u201cIt\u2019s fine\u201d \u2014 she said\u2026", language) == (
        '"It\'s fine" - she said...'
    )
    assert normalize("\u00abquoted\u00bb \u2013 en dash", language) == '"quoted" - en dash'


def test_nfc_composes_decomposed_characters() -> None:
    decomposed = "cafe\u0301"  # e + combining acute

    assert normalize(decomposed, Language.EN) == "café"


@pytest.mark.parametrize("language", ALL_LANGUAGES)
def test_invisible_bidi_and_zero_width_characters_are_dropped(language: Language) -> None:
    text = "\ufeffa\u200bb\u200cc\u200dd\u200ee\u200ff\u061cg\u2060h"

    assert normalize(text, language) == "abcdefgh"


def test_english_accents_are_kept() -> None:
    # Only marks in the Hebrew/Arabic blocks are stripped; Latin accents stay.
    assert normalize("naïve café", Language.EN) == "naïve café"


# --- Hebrew -----------------------------------------------------------------


def test_hebrew_niqqud_is_stripped() -> None:
    # שָׁלוֹם (shalom with qamats, shin dot, holam) -> שלום
    pointed = "ש\u05b8\u05c1לו\u05b9ם"

    assert normalize(pointed, Language.HE) == "שלום"


def test_hebrew_cantillation_is_stripped() -> None:
    # בְּרֵאשִׁ֖ית with the tipcha accent (U+0596) -> בראשית
    accented = "ב\u05bc\u05b0ר\u05b5אש\u05c1\u05b4\u0596ית"

    assert normalize(accented, Language.HE) == "בראשית"


def test_hebrew_geresh_gershayim_and_maqaf_become_ascii() -> None:
    # ד״ר (Dr.), ג׳ינס (jeans) and בית־ספר (school, with maqaf)
    assert normalize("ד\u05f4ר", Language.HE) == 'ד"ר'
    assert normalize("ג\u05f3ינס", Language.HE) == "ג'ינס"
    assert normalize("בית\u05beספר", Language.HE) == "בית-ספר"


def test_hebrew_yiddish_ligatures_and_sof_pasuq_unfold() -> None:
    assert normalize("\u05f0 \u05f1 \u05f2 \u05c3", Language.HE) == "וו וי יי :"


def test_hebrew_final_letters_are_not_folded() -> None:
    # ך (final kaf) and כ (kaf) are different keys; the text keeps whichever it has.
    assert normalize("מלך", Language.HE) == "מלך"
    assert normalize("מלכ", Language.HE) == "מלכ"
    assert normalize("מלך", Language.HE) != normalize("מלכ", Language.HE)


def test_hebrew_punctuation_that_is_on_the_keyboard_is_kept() -> None:
    assert normalize("שלום, עולם! מה נשמע?", Language.HE) == "שלום, עולם! מה נשמע?"


def test_hebrew_presentation_forms_unfold() -> None:
    # U+FB31 is "bet with dagesh" as a single compatibility character.
    assert normalize("בּ", Language.HE) == "ב"


# --- Arabic -----------------------------------------------------------------


def test_arabic_tashkeel_is_stripped() -> None:
    # مُحَمَّدٌ (fully vowelled) -> محمد
    vowelled = "م\u064fح\u064eم\u0651\u064eد\u064c"

    assert normalize(vowelled, Language.AR) == "محمد"


def test_arabic_superscript_alef_and_quranic_marks_are_stripped() -> None:
    # الرحمٰن with dagger alef (U+0670), plus a Quranic small high seen (U+06DC)
    text = "الرحم\u0670ن\u06dc"

    assert normalize(text, Language.AR) == "الرحمن"


def test_arabic_tatweel_is_stripped() -> None:
    # كـــتاب (stretched with kashida) -> كتاب
    assert normalize("ك\u0640\u0640\u0640تاب", Language.AR) == "كتاب"


def test_arabic_alef_wasla_becomes_plain_alef() -> None:
    # ٱلله (Quranic spelling) -> الله
    assert normalize("\u0671\u0644\u0644\u0647", Language.AR) == "الله"


def test_arabic_persian_lookalike_letters_are_mapped_to_arabic_keys() -> None:
    # Persian kaf/yeh and Urdu heh are not on the Arabic 101 keyboard.
    assert normalize("\u06a9\u062a\u0627\u0628", Language.AR) == "كتاب"
    assert normalize("\u0639\u0644\u06cc", Language.AR) == "علي"
    assert normalize("\u06be\u0648", Language.AR) == "هو"


def test_arabic_ascii_punctuation_becomes_arabic_punctuation() -> None:
    assert normalize("مرحبا, كيف حالك? بخير; شكرا.", Language.AR) == "مرحبا، كيف حالك؟ بخير؛ شكرا."


def test_arabic_letter_variants_are_not_folded() -> None:
    # Hamza forms, ta marbuta / ha and alef maqsura / ya are all distinct keys.
    for word in ("أحمد", "احمد", "مدرسة", "مدرسه", "على", "علي"):
        assert normalize(word, Language.AR) == word
    assert normalize("أحمد", Language.AR) != normalize("احمد", Language.AR)
    assert normalize("مدرسة", Language.AR) != normalize("مدرسه", Language.AR)
    assert normalize("على", Language.AR) != normalize("علي", Language.AR)


def test_arabic_punctuation_that_is_on_the_keyboard_is_kept() -> None:
    text = "مرحبا\u060c كيف حالك\u061f نعم! الوقت: الآن."

    assert normalize(text, Language.AR) == text


def test_arabic_presentation_forms_unfold() -> None:
    # U+FEFB is the lam-alef ligature as one compatibility character.
    assert normalize("ﻻ", Language.AR) == "لا"


def test_ascii_punctuation_is_untouched_outside_arabic() -> None:
    assert normalize("yes, no; why?", Language.EN) == "yes, no; why?"
    assert normalize("כן, לא; למה?", Language.HE) == "כן, לא; למה?"


def test_arabic_marks_are_not_stripped_from_other_languages() -> None:
    # A Hebrew text quoting an Arabic word keeps the Arabic vowels (and vice versa):
    # each language strips only its own block.
    assert normalize("ب\u064e", Language.HE) == "ب\u064e"
    assert normalize("ש\u05b8", Language.AR) == "ש\u05b8"


# --- idempotence -------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "language"),
    [
        ("\u201cHello\u201d \u2014 world\u2026", Language.EN),
        ("ש\u05b8\u05c1לו\u05b9ם ד\u05f4ר", Language.HE),
        ("م\u064fح\u064eم\u0651\u064eد\u064c ك\u0640تاب", Language.AR),
    ],
)
def test_normalize_is_idempotent(text: str, language: Language) -> None:
    once = normalize(text, language)

    assert normalize(once, language) == once
