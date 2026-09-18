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

const NO_DATA = 'border-dashed bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-600'

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
      <div className="flex flex-col items-center gap-1" data-testid="heatmap">
        {layout.rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map((key, j) => {
              const { errors, total, errorRate } = statsFor(key, byChar)
              const pct = (errorRate * 100).toFixed(errorRate >= 0.1 ? 0 : 1)
              const title = total
                ? `${key.label}: ${errors} missed of ${total} (${pct}%)`
                : `${key.label}: not typed yet`
              return (
                <span
                  key={j}
                  title={title}
                  aria-label={title}
                  data-testid={`key-${key.chars[0] ?? key.label}`}
                  data-error-rate={total ? errorRate.toFixed(4) : ''}
                  style={key.width ? { width: `${key.width * 2.5}rem` } : undefined}
                  className={`flex h-10 w-10 items-center justify-center rounded border text-sm
                    ${total ? binOf(errorRate).className : NO_DATA}`}
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
          <span className={`inline-block h-3 w-3 rounded-sm border ${NO_DATA}`} />
          not typed
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
