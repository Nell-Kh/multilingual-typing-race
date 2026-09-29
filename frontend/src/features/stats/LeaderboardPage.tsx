import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, isLanguage, loadPracticeLanguage, savePracticeLanguage } from '../../i18n/languages'
import { ApiError, leaderboards, type Language, type LeaderboardRow, type Period } from '../../lib/api'
import { Segmented } from '../../ui/Segmented'
import { useTitle } from '../../ui/useTitle'
import { useAuth } from '../auth/store'

const PERIODS: { value: Period; label: string; empty: string }[] = [
  { value: 'all', label: 'All-time', empty: 'yet' },
  { value: 'week', label: 'Weekly', empty: 'this week' },
  { value: 'day', label: 'Daily', empty: 'today' },
]

const PRIMARY_LINK =
  'inline-flex min-h-10 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-surface ' +
  'hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/**
 * All-time / Weekly / Daily as a real tab list: arrow keys move between tabs, and
 * only the selected tab is in the Tab order (WAI-ARIA tabs pattern).
 */
function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKeyDown(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? PERIODS.length - 1 : (i + step + PERIODS.length) % PERIODS.length
    if (step === 0 && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    onChange(PERIODS[to].value)
    refs.current[to]?.focus()
  }
  return (
    <div role="tablist" aria-label="Period" className="flex gap-1 border-b border-line">
      {PERIODS.map((p, i) => {
        const on = p.value === value
        return (
          <button
            key={p.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${p.value}`}
            aria-selected={on}
            aria-controls="board-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(p.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px min-h-10 border-b-2 px-3 text-sm font-medium
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
              ${on ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({ r, isMe, pinned = false }: { r: LeaderboardRow; isMe: boolean; pinned?: boolean }) {
  return (
    <tr
      data-testid={pinned ? 'row-pinned' : `row-${r.user_id}`}
      data-rank={r.rank}
      data-pinned={pinned || undefined}
      aria-current={isMe ? 'true' : undefined}
      className={`border-b border-line last:border-b-0 ${isMe ? 'bg-accent-soft' : ''}
        ${pinned ? 'sticky bottom-0 shadow-[0_-1px_0_var(--color-line),0_-6px_12px_-8px_rgb(0_0_0/0.25)]' : ''}`}
    >
      {/* The rank is the server's (ADR-025): tied players share it, and the next rank skips past them. */}
      <td className={`py-2.5 ps-3 pe-2 text-base font-bold tabular-nums ${r.rank <= 3 && !pinned ? 'text-accent' : ''}`}>
        {r.rank}
      </td>
      <td className="max-w-0 py-2.5 pe-3">
        <span className="flex min-w-0 items-center gap-2">
          <bdi className="truncate font-medium">{r.display_name}</bdi>
          {isMe && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[11px] font-medium text-surface">you</span>
          )}
        </span>
      </td>
      <td className="py-2.5 pe-3 text-end font-medium tabular-nums">{r.wpm}</td>
      <td className="py-2.5 pe-3 text-end tabular-nums text-muted">{r.accuracy}%</td>
    </tr>
  )
}

export default function LeaderboardPage() {
  const me = useAuth((s) => s.user)
  const [params] = useSearchParams()
  const isDaily = params.get('daily') === '1'
  useTitle(isDaily ? "Today's challenge" : 'Leaderboard')
  const fromUrl = params.get('lang')
  const [language, setLanguage] = useState<Language>(() => (isLanguage(fromUrl) ? fromUrl : loadPracticeLanguage()))
  const [period, setPeriod] = useState<Period>('week')
  const board = useQuery({
    queryKey: isDaily ? ['leaderboard', 'daily', language] : ['leaderboard', language, period],
    queryFn: () => (isDaily ? leaderboards.daily(language) : leaderboards.get(language, period)),
  })
  const inTop = board.data?.rows.some((r) => r.user_id === me?.id) ?? false
  const label = LANGUAGES[language].label
  const when = PERIODS.find((p) => p.value === period)?.empty ?? ''

  return (
    <main className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">{isDaily ? "Today's challenge" : 'Leaderboard'}</h1>
        <p className="m-0 text-sm text-muted">
          {isDaily ? (
            <>
              Each player&apos;s best run on today&apos;s text.{' '}
              <Link className="font-medium text-accent underline" to="/leaderboard">
                All boards
              </Link>
            </>
          ) : (
            "Each player's best counted run. Tied speeds share a rank."
          )}
        </p>
      </header>

      <Segmented
        label="Language"
        value={language}
        onChange={setLanguage}
        options={LANGUAGE_CODES.map((c) => ({ value: c, label: LANGUAGES[c].label, lang: c }))}
      />

      <section
        aria-label="board"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 sm:p-5"
      >
        {!isDaily && <PeriodTabs value={period} onChange={setPeriod} />}
        <div
          id="board-panel"
          role={isDaily ? undefined : 'tabpanel'}
          aria-labelledby={isDaily ? undefined : `tab-${period}`}
          className="flex flex-col gap-3"
        >
          {board.isPending && (
            <p className="m-0 px-1 py-2 text-sm text-muted" aria-busy="true">
              Loading…
            </p>
          )}
          {board.isError && (
            <p role="alert" className="m-0 px-1 py-2 text-sm text-err">
              {board.error instanceof ApiError ? board.error.message : 'Could not load the leaderboard.'}
            </p>
          )}
          {board.data && board.data.rows.length === 0 && (
            <div data-testid="board-empty" className="flex flex-col items-start gap-3 px-1 py-4">
              <p className="m-0 font-medium">
                {isDaily ? (
                  <>
                    Nobody has typed today&apos;s <bdi lang={language}>{label}</bdi> text yet.
                  </>
                ) : (
                  <>
                    No counted runs in <bdi lang={language}>{label}</bdi> {when}.
                  </>
                )}
              </p>
              <p className="m-0 text-sm text-muted">Finish a run and you will be first on this board.</p>
              <Link
                to={isDaily ? `/practice?daily=1&lang=${language}` : '/practice'}
                // Practice starts in the remembered language, so remember this board's.
                onClick={() => savePracticeLanguage(language)}
                className={PRIMARY_LINK}
              >
                {isDaily ? "Type today's text" : 'Start practice'}
              </Link>
            </div>
          )}
          {board.data && board.data.rows.length > 0 && (
            // No overflow wrapper: four columns fit 360px, and a scroll container
            // would stop the pinned row from sticking to the bottom of the screen.
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-14" />
                <col />
                <col className="w-20 sm:w-28" />
                <col className="w-20 sm:w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
                  <th className="py-2 ps-3 pe-2 text-start font-medium">Rank</th>
                  <th className="py-2 pe-3 text-start font-medium">Player</th>
                  <th className="py-2 pe-3 text-end font-medium">WPM</th>
                  <th className="py-2 pe-3 text-end font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {board.data.rows.map((r) => (
                  <Row key={r.user_id} r={r} isMe={r.user_id === me?.id} />
                ))}
                {board.data.me && !inTop && (
                  <>
                    <tr aria-hidden="true">
                      <td colSpan={4} className="py-1 text-center text-muted">
                        ⋯
                      </td>
                    </tr>
                    <Row r={board.data.me} isMe pinned />
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  )
}
