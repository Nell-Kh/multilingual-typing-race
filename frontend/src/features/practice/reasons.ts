/** Why the server did not count a run, in words a player can act on. */
const REASONS: Record<string, string> = {
  empty_log: 'No keystrokes arrived with the run.',
  text_mismatch: "What was typed doesn't match the text.",
  median_gap_too_low: 'Typing was faster than a person can sustain.',
  machine_run: 'A burst of keys arrived too fast to be typed by hand.',
  too_few_keystrokes: 'Fewer keystrokes than characters in the text.',
  time_not_monotonic: 'Keystroke times went backwards.',
  duration_disagrees_with_server: "The run's length doesn't match what the server measured.",
  flagged_for_review: 'Very high speed, so it is kept for review.',
}

/** The plain-words reason for a validator code; the code itself if it is new. */
export function reasonText(code: string): string {
  return REASONS[code] ?? code
}
