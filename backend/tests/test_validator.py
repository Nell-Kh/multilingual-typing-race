import pytest

from app.services.typing_metrics import BACKSPACE, Keystroke
from app.services.validator import (
    MACHINE_RUN_KEYS,
    MIN_MEDIAN_GAP_MS,
    REVIEW_WPM,
    validate,
)

TARGET = "the quick brown fox jumps over the lazy dog"


def human(text: str = TARGET, gap_ms: int = 120) -> list[Keystroke]:
    return [(gap_ms * (i + 1), ch, ch) for i, ch in enumerate(text)]


def duration(log: list[Keystroke]) -> int:
    return log[-1][0]


def test_honest_session_is_valid() -> None:
    log = human()

    v = validate(log, TARGET, wpm=60, client_duration_ms=duration(log))

    assert v.valid and v.reason is None and not v.flagged_for_review


def test_corrected_mistakes_are_still_valid() -> None:
    log: list[Keystroke] = [
        (100, "t", "t"),
        (220, "h", "j"),
        (300, "", BACKSPACE),
        (450, "h", "h"),
        *[(450 + 120 * (i + 1), ch, ch) for i, ch in enumerate(TARGET[2:])],
    ]

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).valid


def test_empty_log() -> None:
    assert validate([], TARGET, wpm=0, client_duration_ms=1).reason == "empty_log"


def test_too_few_keystrokes() -> None:
    log = human(TARGET[:-1])  # one character short, however it happened

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).reason == (
        "too_few_keystrokes"
    )


def test_wrong_final_text() -> None:
    log = human(TARGET[:-1] + "!")

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).reason == (
        "text_mismatch"
    )


def test_uncorrected_error_is_a_mismatch_not_a_valid_session() -> None:
    log = human()
    log[5] = (log[5][0], "u", "i")  # typo left in place

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).reason == (
        "text_mismatch"
    )


def test_time_going_backwards() -> None:
    log = human()
    log[10] = (log[9][0] - 50, *log[10][1:])

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).reason == (
        "time_not_monotonic"
    )


def test_inhumanly_fast_median_gap() -> None:
    log = human(gap_ms=MIN_MEDIAN_GAP_MS - 1)

    assert validate(log, TARGET, wpm=999, client_duration_ms=duration(log)).reason == (
        "median_gap_too_low"
    )


def test_pasted_burst_inside_a_human_session() -> None:
    log = human(gap_ms=150)  # 43 keys, comfortably human median
    # Rewrite MACHINE_RUN_KEYS consecutive keys to arrive 2 ms apart.
    start = 20
    base = log[start - 1][0]
    for i in range(start, start + MACHINE_RUN_KEYS):
        log[i] = (base + 2 * (i - start + 1), *log[i][1:])
    # Keep the rest monotonic after the burst.
    shift = log[start + MACHINE_RUN_KEYS - 1][0] + 150
    for i in range(start + MACHINE_RUN_KEYS, len(log)):
        log[i] = (shift + 150 * (i - (start + MACHINE_RUN_KEYS)), *log[i][1:])

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).reason == ("machine_run")


def test_a_short_burst_is_fine() -> None:
    log = human(gap_ms=150)
    for i in range(20, 20 + MACHINE_RUN_KEYS - 2):  # one short of the threshold
        log[i] = (log[19][0] + 2 * (i - 19), *log[i][1:])
    shift = log[20 + MACHINE_RUN_KEYS - 3][0] + 150
    for i in range(20 + MACHINE_RUN_KEYS - 2, len(log)):
        log[i] = (shift + 150 * (i - (20 + MACHINE_RUN_KEYS - 2)), *log[i][1:])

    assert validate(log, TARGET, wpm=60, client_duration_ms=duration(log)).valid


def test_race_duration_must_agree_with_server() -> None:
    log = human()
    d = duration(log)

    ok = validate(log, TARGET, wpm=60, client_duration_ms=d, server_duration_ms=d + 1400)
    bad = validate(log, TARGET, wpm=60, client_duration_ms=d, server_duration_ms=d + 1600)

    assert ok.valid
    assert bad.reason == "duration_disagrees_with_server"


def test_absurd_wpm_is_flagged_not_rejected() -> None:
    log = human(gap_ms=40)  # fast but above the median floor

    v = validate(log, TARGET, wpm=REVIEW_WPM + 1, client_duration_ms=duration(log))

    assert v.valid and v.flagged_for_review


@pytest.mark.parametrize("text", ["שלום עולם", "مرحبا بالعالم"])
def test_rtl_targets_validate_the_same_way(text: str) -> None:
    log = human(text)

    assert validate(log, text, wpm=40, client_duration_ms=duration(log)).valid
