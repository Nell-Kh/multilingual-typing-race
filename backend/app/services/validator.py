"""Anti-cheat: is this keystroke log a real person typing the target text?

The client is never trusted for numbers; it only sends the log. This module
either accepts the log or names a reason. Rejected sessions are still stored
(`is_valid=false`) so they can be inspected, but never reach leaderboards.
The rules come from the brief, §7.
"""

from dataclasses import dataclass
from statistics import median

from app.services.typing_metrics import Keystroke, is_backspace, replay

# Faster than any human sustains between keys (world-class bursts are ~40 ms).
MIN_MEDIAN_GAP_MS = 30
# A median needs a sample: below this many gaps the check is skipped rather than
# risk a false positive on a short text (ADR-015). Machine-run detection below is
# not gated: it looks at consecutive keys, which is meaningful at any length.
MIN_GAPS_FOR_MEDIAN = 20
# This many consecutive keys with (near-)zero gaps is a paste or a script.
MACHINE_RUN_KEYS = 10
MACHINE_RUN_GAP_MS = 5
# Not a rejection: above this the session is kept but flagged for a human look.
REVIEW_WPM = 250
# Races: the client's clock must agree with what the server observed.
RACE_DURATION_TOLERANCE_MS = 1500


@dataclass(frozen=True)
class Verdict:
    valid: bool
    reason: str | None = None  # machine-readable, e.g. "text_mismatch"
    flagged_for_review: bool = False


def validate(
    keystrokes: list[Keystroke],
    target: str,
    *,
    wpm: float,
    client_duration_ms: int,
    server_duration_ms: int | None = None,
) -> Verdict:
    """Apply every rule in order; the first failure wins."""
    if not keystrokes:
        return Verdict(False, "empty_log")

    typed_chars = sum(1 for k in keystrokes if not is_backspace(k))
    if typed_chars < len(target):
        # Producing N characters takes at least N character keystrokes.
        return Verdict(False, "too_few_keystrokes")

    if replay(keystrokes) != target:
        return Verdict(False, "text_mismatch")

    gaps = [b[0] - a[0] for a, b in zip(keystrokes, keystrokes[1:], strict=False)]
    if any(g < 0 for g in gaps):
        return Verdict(False, "time_not_monotonic")
    if len(gaps) >= MIN_GAPS_FOR_MEDIAN and median(gaps) < MIN_MEDIAN_GAP_MS:
        return Verdict(False, "median_gap_too_low")
    run = 1
    for gap in gaps:
        run = run + 1 if gap <= MACHINE_RUN_GAP_MS else 1
        if run >= MACHINE_RUN_KEYS:
            return Verdict(False, "machine_run")

    if (
        server_duration_ms is not None
        and abs(client_duration_ms - server_duration_ms) > RACE_DURATION_TOLERANCE_MS
    ):
        return Verdict(False, "duration_disagrees_with_server")

    return Verdict(True, flagged_for_review=wpm > REVIEW_WPM)
