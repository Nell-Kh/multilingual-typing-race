"""Speed and accuracy from a raw keystroke log. Pure functions, no I/O.

The client records one entry per keystroke that changed the text:

    [t_ms, expected, typed]     t_ms: milliseconds since the session started
                                expected: the target character at the caret
                                typed: the character the user produced

A backspace is `[t_ms, "", "\\b"]`. Replaying the log (append a char, pop on
backspace) reproduces exactly what the user ended up with — that is how the
validator checks the text, and how a corrected mistake still counts as an error.

Definitions (in the README, identical for all languages):
    WPM       = (correct characters / 5) / minutes      a "word" is 5 characters
    raw WPM   = (all typed characters / 5) / minutes    speed ignoring mistakes
    CPM       = correct characters / minutes
    accuracy  = correct / (correct + errors) * 100      backspaces are neither
"""

from collections import defaultdict
from dataclasses import dataclass, field

BACKSPACE = "\b"

# One keystroke: (time since start in ms, expected char or "", typed char or BACKSPACE)
Keystroke = tuple[int, str, str]


def is_backspace(keystroke: Keystroke) -> bool:
    return keystroke[2] == BACKSPACE


@dataclass(frozen=True)
class KeyStat:
    correct: int = 0
    errors: int = 0
    latencies_ms: tuple[int, ...] = ()

    @property
    def avg_latency_ms(self) -> float | None:
        if not self.latencies_ms:
            return None
        return round(sum(self.latencies_ms) / len(self.latencies_ms), 1)


@dataclass(frozen=True)
class Metrics:
    duration_ms: int
    keystroke_count: int  # every entry, backspaces included
    correct_count: int
    error_count: int
    wpm: float
    raw_wpm: float
    cpm: float
    accuracy: float  # percent, 0-100
    per_key: dict[str, KeyStat] = field(default_factory=dict)


def parse_keystrokes(raw: list[list[object]]) -> list[Keystroke]:
    """Check the shape of a client log. Raises ValueError with the entry index."""
    parsed: list[Keystroke] = []
    for i, entry in enumerate(raw):
        if len(entry) != 3:
            raise ValueError(f"keystroke {i}: expected [t_ms, expected, typed]")
        t_ms, expected, typed = entry
        if isinstance(t_ms, bool) or not isinstance(t_ms, int) or t_ms < 0:
            raise ValueError(f"keystroke {i}: t_ms must be a non-negative integer")
        if not (isinstance(expected, str) and isinstance(typed, str)):
            raise ValueError(f"keystroke {i}: expected and typed must be strings")
        if typed == BACKSPACE:
            if expected != "":
                raise ValueError(f"keystroke {i}: a backspace has no expected character")
        elif len(expected) != 1 or len(typed) != 1:
            raise ValueError(f"keystroke {i}: expected and typed must be single characters")
        parsed.append((t_ms, expected, typed))
    return parsed


def replay(keystrokes: list[Keystroke]) -> str:
    """The text the user ended up with."""
    buffer: list[str] = []
    for keystroke in keystrokes:
        if is_backspace(keystroke):
            if buffer:
                buffer.pop()
        else:
            buffer.append(keystroke[2])
    return "".join(buffer)


def compute(keystrokes: list[Keystroke], duration_ms: int) -> Metrics:
    """Speed, accuracy and per-key stats. `duration_ms` comes from the caller
    (last keystroke time for practice; the server-observed span in races)."""
    if duration_ms <= 0:
        raise ValueError("duration_ms must be positive")

    minutes = duration_ms / 60_000
    correct = errors = 0
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    latencies: dict[str, list[int]] = defaultdict(list)
    previous_t = 0

    for keystroke in keystrokes:
        t_ms, expected, typed = keystroke
        if not is_backspace(keystroke):
            if typed == expected:
                correct += 1
                counts[expected][0] += 1
                latencies[expected].append(t_ms - previous_t)
            else:
                errors += 1
                counts[expected][1] += 1
        previous_t = t_ms

    typed_chars = correct + errors
    return Metrics(
        duration_ms=duration_ms,
        keystroke_count=len(keystrokes),
        correct_count=correct,
        error_count=errors,
        wpm=round((correct / 5) / minutes, 2),
        raw_wpm=round((typed_chars / 5) / minutes, 2),
        cpm=round(correct / minutes, 2),
        accuracy=round(correct / typed_chars * 100, 2) if typed_chars else 0.0,
        per_key={
            key: KeyStat(correct=c, errors=e, latencies_ms=tuple(latencies[key]))
            for key, (c, e) in counts.items()
        },
    )
