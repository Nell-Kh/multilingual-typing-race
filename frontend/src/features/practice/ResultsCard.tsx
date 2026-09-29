import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { LeaderboardRow, ScoredRun } from '../../lib/api'
import { Button } from '../../ui/Button'
import { StatStrip } from '../../ui/StatStrip'
import { reasonText } from './reasons'

interface Props {
  result: ScoredRun
  /** A guest run: judged the same way, kept nowhere (ADR-034). */
  guest?: boolean
  /** Free practice: fetch a different text. Absent on the daily challenge. */
  onNext?: () => void
  onRetry: () => void
  /** Daily only: the daily board's link and the player's row on it, if any. */
  daily?: { href: string; me: LeaderboardRow | null | undefined }
}

function duration(ms: number): string {
  const s = Math.round(ms / 100) / 10
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

/** What the server decided. Every number here came from the server, not the browser. */
export function ResultsCard({ result, guest = false, onNext, onRetry, daily }: Props) {
  const flagged = result.is_valid && result.invalid_reason === 'flagged_for_review'
  // On a phone the card lands below the fold; bring it up when the run is scored.
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (typeof card.current?.scrollIntoView === 'function') {
      card.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [result])
  const worst = [...result.key_stats]
    .filter((k) => k.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 5)

  return (
    <section ref={card} aria-label="results" className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-2xl font-bold">{result.is_valid ? 'Result' : guest ? 'Not valid' : 'Not counted'}</h2>
        <span
          data-testid="result-status"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !result.is_valid ? 'bg-err-soft text-err' : flagged ? 'bg-accent-soft text-accent' : 'bg-paper text-ok'
          }`}
        >
          {!result.is_valid
            ? 'Rejected'
            : guest
              ? 'Valid · not saved'
              : flagged
                ? 'Counted · flagged'
                : 'Counted'}
        </span>
      </div>

      {(!result.is_valid || flagged) && result.invalid_reason && (
        <p role={result.is_valid ? undefined : 'alert'} className={`m-0 text-sm ${result.is_valid ? 'text-muted' : 'text-err'}`}>
          {reasonText(result.invalid_reason)}
        </p>
      )}

      <StatStrip
        label="result"
        size="lg"
        stats={[
          { label: 'Speed', value: <>{result.wpm}<span className="ms-1 text-base font-medium text-muted">wpm</span></>, testId: 'result-wpm' },
          { label: 'Accuracy', value: `${result.accuracy}%`, testId: 'result-accuracy' },
          { label: 'Time', value: duration(result.duration_ms) },
          { label: 'Errors', value: result.error_count },
        ]}
      />

      {worst.length > 0 && (
        <p className="m-0 text-sm text-muted">
          Most missed:{' '}
          {worst.map((k) => (
            <kbd key={k.key} dir="ltr" className="mx-1 rounded-md border border-line bg-paper px-2 py-0.5 font-sans text-ink">
              <bdi>{k.key === ' ' ? '␣' : k.key}</bdi>
              <span className="text-muted"> ×{k.errors}</span>
            </kbd>
          ))}
        </p>
      )}

      {guest && (
        <p className="m-0 text-sm" data-testid="guest-result-note">
          This run was scored by the server and not saved.{' '}
          <Link className="font-medium text-accent underline" to="/register">
            Create an account
          </Link>{' '}
          to keep your stats, race friends and take the daily challenge.
        </p>
      )}

      {daily && (
        <p className="m-0 text-sm" data-testid="daily-rank">
          {daily.me
            ? <>Your best today is <strong>#{daily.me.rank}</strong> ({daily.me.wpm} wpm). </>
            : daily.me === null
              ? <>You are not on today&apos;s board yet. </>
              : null}
          <Link className="font-medium text-accent underline" to={daily.href}>
            See today&apos;s leaderboard
          </Link>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {onNext && (
          <Button variant="primary" onClick={onNext}>
            Next text
          </Button>
        )}
        <Button variant={onNext ? 'secondary' : 'primary'} onClick={onRetry}>
          Try again
        </Button>
      </div>
    </section>
  )
}
