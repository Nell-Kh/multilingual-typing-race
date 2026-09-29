/** Runs averaged into the smoothed line. */
export const WINDOW = 7

/**
 * The trailing average of the last WINDOW runs at each run, or null before there
 * are WINDOW of them: a "7-run average" of three runs would be a different number
 * under the same name.
 */
export function movingAverage(values: number[], window = WINDOW): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    const slice = values.slice(i - window + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / window
  })
}
