import pytest

from app.i18n.normalize import normalize
from app.models.enums import Language


def test_english_straightens_quotes_and_dashes() -> None:
    assert normalize("“It’s fine” — she said…", Language.EN) == '"It\'s fine" - she said...'


def test_whitespace_is_collapsed_everywhere() -> None:
    assert normalize("  two   words\n\tand more  ", Language.EN) == "two words and more"
    assert normalize("שלום   עולם", Language.HE) == "שלום עולם"


def test_nfc_composes_decomposed_characters() -> None:
    decomposed = "café"  # e + combining acute

    assert normalize(decomposed, Language.EN) == "café"


@pytest.mark.parametrize("language", [Language.HE, Language.AR])
def test_rtl_languages_keep_their_punctuation_for_now(language: Language) -> None:
    # Curly quotes are an English concern; he/ar rules come in M3.
    assert normalize("“a”", language) == "“a”"
