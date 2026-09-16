import pytest

from app.services.typing_metrics import (
    BACKSPACE,
    Keystroke,
    compute,
    parse_keystrokes,
    replay,
)


def typed(text: str, gap_ms: int = 100, start_ms: int = 0) -> list[Keystroke]:
    """A perfect run: each target char typed correctly, evenly spaced."""
    return [(start_ms + gap_ms * (i + 1), ch, ch) for i, ch in enumerate(text)]


# ---- parse -----------------------------------------------------------------------


def test_parse_accepts_chars_and_backspaces() -> None:
    raw: list[list[object]] = [[120, "a", "a"], [250, "", BACKSPACE], [400, "a", "b"]]

    assert parse_keystrokes(raw) == [(120, "a", "a"), (250, "", BACKSPACE), (400, "a", "b")]


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ([[1, "a"]], "expected \\[t_ms, expected, typed\\]"),
        ([[-1, "a", "a"]], "non-negative"),
        ([[True, "a", "a"]], "non-negative"),
        ([[1.5, "a", "a"]], "non-negative"),
        ([[1, "a", 7]], "must be strings"),
        ([[1, "ab", "a"]], "single characters"),
        ([[1, "a", ""]], "single characters"),
        ([[1, "a", BACKSPACE]], "backspace has no expected"),
    ],
)
def test_parse_rejects_malformed_entries(bad: list[list[object]], message: str) -> None:
    with pytest.raises(ValueError, match=f"keystroke 0: .*{message}"):
        parse_keystrokes(bad)


# ---- replay ----------------------------------------------------------------------


def test_replay_applies_backspaces() -> None:
    log: list[Keystroke] = [
        (100, "c", "c"),
        (200, "a", "q"),  # mistake
        (300, "", BACKSPACE),
        (400, "a", "a"),  # fixed
        (500, "t", "t"),
    ]

    assert replay(log) == "cat"


def test_replay_ignores_backspace_on_empty_buffer() -> None:
    assert replay([(1, "", BACKSPACE), (2, "a", "a")]) == "a"


# ---- compute ---------------------------------------------------------------------


def test_perfect_run_numbers() -> None:
    # 10 correct chars in 12 s: 2 "words" in 0.2 min.
    m = compute(typed("abcdefghij", gap_ms=1200), duration_ms=12_000)

    assert m.correct_count == 10
    assert m.error_count == 0
    assert m.keystroke_count == 10
    assert m.wpm == 10.0
    assert m.raw_wpm == 10.0
    assert m.cpm == 50.0
    assert m.accuracy == 100.0


def test_corrected_mistake_counts_against_accuracy_but_not_result() -> None:
    log: list[Keystroke] = [
        (100, "a", "a"),
        (200, "b", "x"),  # error
        (300, "", BACKSPACE),
        (400, "b", "b"),  # correction
    ]

    m = compute(log, duration_ms=400)

    assert (m.correct_count, m.error_count, m.keystroke_count) == (2, 1, 4)
    assert m.accuracy == 66.67
    assert m.wpm == 60.0  # 2 correct chars / 5 = 0.4 words in 400 ms
    assert m.raw_wpm == 90.0  # 3 typed chars
    assert m.per_key["a"].correct == 1
    assert m.per_key["b"].correct == 1
    assert m.per_key["b"].errors == 1


def test_per_key_latency_is_time_since_previous_keystroke() -> None:
    log: list[Keystroke] = [(150, "a", "a"), (400, "b", "b"), (500, "a", "a")]

    m = compute(log, duration_ms=500)

    assert m.per_key["a"].latencies_ms == (150, 100)
    assert m.per_key["a"].avg_latency_ms == 125.0
    assert m.per_key["b"].avg_latency_ms == 250.0


def test_errors_carry_no_latency() -> None:
    m = compute([(100, "a", "z")], duration_ms=100)

    assert m.per_key["a"].avg_latency_ms is None


def test_empty_log_is_all_zeros() -> None:
    m = compute([], duration_ms=1000)

    assert (m.wpm, m.cpm, m.accuracy, m.keystroke_count) == (0.0, 0.0, 0.0, 0)


@pytest.mark.parametrize("duration", [0, -5])
def test_duration_must_be_positive(duration: int) -> None:
    with pytest.raises(ValueError, match="positive"):
        compute(typed("ab"), duration_ms=duration)


def test_hebrew_and_arabic_are_just_characters() -> None:
    m = compute(typed("שלום"), duration_ms=400)
    assert m.correct_count == 4 and set(m.per_key) == set("שלום")

    m = compute(typed("مرحبا"), duration_ms=500)
    assert m.correct_count == 5 and set(m.per_key) == set("مرحبا")
