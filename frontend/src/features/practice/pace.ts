// Someone to type against when there is nobody to race (ADR-035). Both are pure
// functions of the time since your first key, so they are exact to test and cost
// nothing to redraw.

/** Characters a steady typist at `wpm` has typed after `elapsedMs` (a word is 5 characters). */
export function pacerChars(wpm: number, elapsedMs: number, total: number): number {
  if (elapsedMs <= 0) return 0
  return Math.min(total, Math.floor((wpm * 5 * elapsedMs) / 60_000))
}

/**
 * Characters today's #1 had typed after `elapsedMs`: how many of their per-character
 * times (ascending, from their first key) have passed. Binary search, since this
 * runs on every tick.
 */
export function ghostChars(offsetsMs: readonly number[], elapsedMs: number): number {
  if (elapsedMs < 0) return 0
  let lo = 0
  let hi = offsetsMs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsetsMs[mid] <= elapsedMs) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Your own progress: the characters typed correctly from the start. */
export function correctPrefix(typed: string, target: string): number {
  const a = Array.from(typed)
  const b = Array.from(target)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}
