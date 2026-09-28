import type { CSSProperties } from 'react'
import type { KeyAggregate, Language } from '../../lib/api'
import { LAYOUTS, charsOnLayout, type KeyCap } from './layouts'

interface Props {
  language: Language
  keys: KeyAggregate[]
}

/**
 * Which keys you miss, on the keyboard you actually use.
 *
 * Colour is a sequential one-hue ramp over the error rate (light = clean, dark =
 * missed often), re-stepped for dark mode rather than flipped, and "no data yet"
 * is a neutral grey outside the ramp so it can't be read as "clean". The light
 * end sits below 3:1 against the surface by design — every key carries its
 * visible character and a per-key tooltip, so colour is never the only channel.
 */

interface Bin {
  /** Upper bound of the error rate, exclusive; Infinity for the last bin. */
  max: number
  label: string
  className: string
}

// One hue, rising with the error rate. Dark mode is its own set of steps, not an
// inverted copy: the named dark reds are all vivid, so a clean board would read as
// on fire; a tint that lifts off the surface keeps "near zero" quiet in both modes.
const BINS: Bin[] = [
  // Never missed: no fill at all. "Not typed yet" is also unfilled but keeps a
  // dashed border and muted ink, so the two are told apart without colour.
  { max: 0.0001, label: 'none', className: 'bg-transparent' },
  { max: 0.02, label: 'under 2%', className: 'bg-red-100 dark:bg-red-500/25' },
  { max: 0.05, label: '2–5%', className: 'bg-red-200 dark:bg-red-500/40' },
  { max: 0.1, label: '5–10%', className: 'bg-red-300 dark:bg-red-500/60' },
  { max: Infinity, label: '10%+', className: 'bg-red-400 dark:bg-red-500/85' },
]

/**
 * Below this many keystrokes a key is not coloured at all (ADR-025). One miss out
 * of two is not a 50% error rate, it is two keystrokes; colouring it would put the
 * darkest cell on the board on the key you have pressed least.
 */
const MIN_SAMPLE = 10

const UNJUDGED = 'border-dashed bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-600'

/**
 * The size of one letter key, fitted to the space the board actually has.
 *
 * At full size a key is 2.5rem, and the widest row (13 keys on Arabic 101) is
 * wider than a phone. The board is a size container, so the key is the smaller of
 * 2.5rem and an equal share of the container's width: the whole keyboard stays on
 * screen and in shape instead of scrolling sideways or wrapping a row.
 */
function keySize(rows: KeyCap[][]): string {
  const units = Math.max(...rows.map((r) => r.reduce((sum, k) => sum + (k.width ?? 1), 0)))
  const gaps = Math.max(...rows.map((r) => r.length - 1))
  return `min(2.5rem, calc((100cqw - ${gaps} * 0.25rem) / ${units}))`
}

function binOf(errorRate: number): Bin {
  return BINS.find((b) => errorRate < b.max) ?? BINS[BINS.length - 1]
}

/** Sum the stats of every character a key produces. */
function statsFor(key: KeyCap, byChar: Map<string, KeyAggregate>) {
  let correct = 0
  let errors = 0
  for (const c of key.chars) {
    const stat = byChar.get(c)
    if (stat) {
      correct += stat.correct
      errors += stat.errors
    }
  }
  const total = correct + errors
  return { correct, errors, total, errorRate: total ? errors / total : 0 }
}

export function Heatmap({ language, keys }: Props) {
  const layout = LAYOUTS[language]
  const byChar = new Map(keys.map((k) => [k.key, k]))
  const claimed = charsOnLayout(language)
  const strays = keys.filter((k) => !claimed.has(k.key) && k.correct + k.errors > 0)

  if (keys.length === 0) {
    return <p className="text-sm text-gray-500">No counted runs in this language yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="@container flex flex-col items-center gap-1"
        data-testid="heatmap"
        style={{ '--key': keySize(layout.rows) } as CSSProperties}
      >
        {layout.rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map((key, j) => {
              const { errors, total, errorRate } = statsFor(key, byChar)
              const judged = total >= MIN_SAMPLE
              const pct = (errorRate * 100).toFixed(errorRate >= 0.1 ? 0 : 1)
              const title = judged
                ? `${key.label}: ${errors} missed of ${total} (${pct}%)`
                : total
                  ? `${key.label}: only ${total} so far, too few to judge`
                  : `${key.label}: not typed yet`
              return (
                <span
                  key={j}
                  title={title}
                  aria-label={title}
                  data-testid={`key-${key.chars[0] ?? key.label}`}
                  data-error-rate={judged ? errorRate.toFixed(4) : ''}
                  style={{
                    width: `calc(var(--key) * ${key.width ?? 1})`,
                    height: 'var(--key)',
                    fontSize: 'min(0.875rem, calc(var(--key) * 0.45))',
                  }}
                  className={`flex shrink-0 items-center justify-center rounded border
                    ${judged ? binOf(errorRate).className : UNJUDGED}`}
                >
                  {key.label}
                </span>
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>{layout.name} · missed</span>
        {BINS.map((b) => (
          <span key={b.label} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded-sm border ${b.className}`} />
            {b.label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-sm border ${UNJUDGED}`} />
          under {MIN_SAMPLE} keystrokes
        </span>
      </div>

      {strays.length > 0 && (
        <p className="text-xs text-gray-500" data-testid="stray-keys">
          Not on this layout:{' '}
          {strays.map((k) => (
            <kbd
              key={k.key}
              title={`${k.key}: ${k.errors} missed of ${k.correct + k.errors}`}
              className="mx-1 rounded border px-1 font-mono"
            >
              {k.key === ' ' ? '␣' : k.key}
              <span className="text-gray-400"> ×{k.correct + k.errors}</span>
            </kbd>
          ))}
        </p>
      )}
    </div>
  )
}
