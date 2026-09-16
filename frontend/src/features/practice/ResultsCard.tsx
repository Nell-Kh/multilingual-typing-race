import type { SessionResult } from '../../lib/api'

interface Props {
  result: SessionResult
  onNext: () => void
}

const REASONS: Record<string, string> = {
  text_mismatch: "The text you submitted doesn't match the target.",
  median_gap_too_low: 'Typing was faster than a person can sustain.',
  machine_run: 'A burst of keys arrived too fast to be typed.',
  too_few_keystrokes: 'Fewer keystrokes than characters in the text.',
  time_not_monotonic: 'Keystroke times went backwards.',
  flagged_for_review: 'Very high speed — kept for review.',
}

/** What the server decided. Every number here came from the server, not the browser. */
export function ResultsCard({ result, onNext }: Props) {
  const worst = [...result.key_stats]
    .filter((k) => k.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 5)

  return (
    <section aria-label="results" className="mx-auto w-full max-w-3xl rounded-lg border p-6">
      <h2 className="mb-4 text-xl font-bold">
        {result.is_valid ? 'Result' : 'Not counted'}
      </h2>
      {!result.is_valid && result.invalid_reason && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {REASONS[result.invalid_reason] ?? result.invalid_reason}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 font-mono sm:grid-cols-4">
        <div>
          <dt className="text-sm text-gray-500">WPM</dt>
          <dd className="text-3xl" data-testid="result-wpm">
            {result.wpm}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">accuracy</dt>
          <dd className="text-3xl" data-testid="result-accuracy">
            {result.accuracy}%
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">raw WPM</dt>
          <dd className="text-3xl">{result.raw_wpm}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">time</dt>
          <dd className="text-3xl">{(result.duration_ms / 1000).toFixed(1)}s</dd>
        </div>
      </dl>
      {worst.length > 0 && (
        <p className="mt-4 text-sm">
          Most missed:{' '}
          {worst.map((k) => (
            <kbd key={k.key} className="mx-1 rounded border px-2 py-0.5 font-mono">
              {k.key === ' ' ? '␣' : k.key}
              <span className="text-gray-500"> ×{k.errors}</span>
            </kbd>
          ))}
        </p>
      )}
      <button type="button" onClick={onNext} className="mt-6 rounded bg-blue-600 px-4 py-2 text-white">
        Next text
      </button>
    </section>
  )
}
