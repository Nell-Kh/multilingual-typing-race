import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage } from '../../i18n/languages'
import { ApiError, stats, type Language, type LanguageStats, type SessionSummary } from '../../lib/api'
import { myStatsQuery } from '../../lib/queries'
import { Button } from '../../ui/Button'
import { Segmented } from '../../ui/Segmented'
import { useTitle } from '../../ui/useTitle'
import { reasonText } from '../practice/reasons'
import { Heatmap } from './Heatmap'
import { Trend } from './Trend'

const PRIMARY_LINK =
  'inline-flex min-h-10 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-surface ' +
  'hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const MODE: Record<SessionSummary['mode'], string> = { practice: 'Practice', race: 'Race', daily: 'Daily' }

/** Time spent typing, at a scale that fits it: a first run is seconds, not "0 min". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function Card({ label, title, action, children }: { label: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function LanguageCard({ s }: { s: LanguageStats }) {
  const rows: [string, ReactNode][] = [
    ['Average', <>{s.avg_wpm} <span className="text-muted">wpm</span></>],
    ['Accuracy', `${s.avg_accuracy}%`],
    ['Runs', s.runs],
    ['Time', duration(s.total_time_ms)],
  ]
  return (
    <section
      aria-label={LANGUAGES[s.language].label}
      data-testid={`lang-${s.language}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <h2 className="m-0 text-base font-bold" lang={s.language}>
        {LANGUAGES[s.language].label}
      </h2>
      <p className="m-0 flex flex-col">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Best</span>
        <span className="text-3xl font-bold tabular-nums">
          {s.best_wpm} <span className="text-base font-medium text-muted">wpm</span>
        </span>
      </p>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="m-0 text-end font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Counted({ run }: { run: SessionSummary }) {
  if (run.is_valid) return <span className="text-ok">counted</span>
  return (
    <span className="text-err">
      not counted
      {run.invalid_reason && <span className="block text-xs text-muted">{reasonText(run.invalid_reason)}</span>}
    </span>
  )
}

function History({ runs }: { runs: SessionSummary[] }) {
  return (
    <>
      {/* Phones: one card per run; six columns do not fit 360px without scrolling. */}
      <ol className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden">
        {runs.map((r) => (
          <li
            key={r.id}
            data-testid={`run-card-${r.id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-card border border-line px-3 py-2.5"
          >
            <span className="text-sm font-medium">
              <bdi lang={r.language}>{LANGUAGES[r.language].label}</bdi> · {MODE[r.mode]}
            </span>
            <span className="text-end text-lg font-bold tabular-nums">
              {r.wpm} <span className="text-xs font-medium text-muted">wpm</span>
            </span>
            <span className="text-xs text-muted">{when(r.started_at)}</span>
            <span className="text-end text-sm tabular-nums">{r.accuracy}%</span>
            <span className="col-span-2 text-sm">
              <Counted run={r} />
            </span>
          </li>
        ))}
      </ol>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
            <th className="py-2 pe-3 text-start font-medium">When</th>
            <th className="py-2 pe-3 text-start font-medium">Language</th>
            <th className="py-2 pe-3 text-start font-medium">Mode</th>
            <th className="py-2 pe-3 text-end font-medium">WPM</th>
            <th className="py-2 pe-3 text-end font-medium">Accuracy</th>
            <th className="py-2 text-start font-medium">Counted</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} data-testid={`run-${r.id}`} className="border-b border-line last:border-b-0">
              <td className="py-2.5 pe-3 whitespace-nowrap text-muted">{when(r.started_at)}</td>
              <td className="py-2.5 pe-3">
                <bdi lang={r.language}>{LANGUAGES[r.language].label}</bdi>
              </td>
              <td className="py-2.5 pe-3">{MODE[r.mode]}</td>
              <td className="py-2.5 pe-3 text-end font-medium tabular-nums">{r.wpm}</td>
              <td className="py-2.5 pe-3 text-end tabular-nums">{r.accuracy}%</td>
              <td className="py-2.5">
                <Counted run={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function StatsPage() {
  useTitle('Your stats')
  const me = useQuery(myStatsQuery())
  // Default to the language with the most runs (a heatmap of a language you have
  // never typed is an empty board); an explicit pick always wins.
  const [picked, setPicked] = useState<Language | null>(null)
  const busiest = me.data?.languages.reduce(
    (best, s) => (best && best.runs >= s.runs ? best : s),
    undefined as { language: Language; runs: number } | undefined,
  )
  const keyLang = picked ?? busiest?.language ?? loadPracticeLanguage()
  const keys = useQuery({
    queryKey: ['me', 'keys', keyLang],
    queryFn: () => stats.keys(keyLang),
  })
  const history = useInfiniteQuery({
    queryKey: ['me', 'sessions'],
    queryFn: ({ pageParam }) => stats.sessions(undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const runs: SessionSummary[] = history.data?.pages.flatMap((p) => p.items) ?? []
  // Same order as everywhere else in the app, not whatever order the server grouped them in.
  const languages = [...(me.data?.languages ?? [])].sort(
    (a, b) => LANGUAGE_CODES.indexOf(a.language) - LANGUAGE_CODES.indexOf(b.language),
  )
  const brandNew = me.data !== undefined && languages.length === 0 && history.isSuccess && runs.length === 0

  return (
    <main className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">Your stats</h1>
        <p className="m-0 text-sm text-muted">
          Speeds, the trend and weak keys use counted runs. The history lists every run.
        </p>
      </header>

      {me.isPending && (
        <p className="m-0 text-sm text-muted" aria-busy="true">
          Loading your stats…
        </p>
      )}
      {me.isError && (
        <p role="alert" className="m-0 text-sm text-err">
          {me.error instanceof ApiError ? me.error.message : 'Could not load your stats.'}
        </p>
      )}

      {me.data && languages.length === 0 && (
        <section
          aria-label="No runs yet"
          data-testid="stats-empty"
          className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-5 sm:p-8"
        >
          <h2 className="m-0 text-lg font-bold">No counted runs yet</h2>
          <p className="m-0 max-w-prose text-muted">
            Finish a practice run and this page fills in: your best and average speed in each language, how you are
            improving, and the keys you miss most.
          </p>
          <Link to="/practice" className={PRIMARY_LINK}>
            Start practice
          </Link>
        </section>
      )}

      {languages.length > 0 && me.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4" aria-label="per language" role="group">
            {languages.map((s) => (
              <LanguageCard key={s.language} s={s} />
            ))}
          </div>

          <Card label="trend" title="Speed over time">
            <Trend points={me.data.trend} />
          </Card>

          <Card
            label="keyboard"
            title="Keys you miss"
            action={
              <Segmented
                label="Keyboard language"
                value={keyLang}
                onChange={setPicked}
                options={LANGUAGE_CODES.map((c) => ({ value: c, label: LANGUAGES[c].label, lang: c }))}
              />
            }
          >
            {keys.isPending && <p className="m-0 text-sm text-muted">Loading…</p>}
            {keys.isError && (
              <p role="alert" className="m-0 text-sm text-err">
                {keys.error instanceof ApiError ? keys.error.message : 'Could not load your keys.'}
              </p>
            )}
            {keys.data && <Heatmap language={keyLang} keys={keys.data.keys} />}
          </Card>
        </>
      )}

      {!brandNew && (
        <Card label="history" title="History">
          {history.isPending && <p className="m-0 text-sm text-muted">Loading…</p>}
          {history.isError && (
            <p role="alert" className="m-0 text-sm text-err">
              {history.error instanceof ApiError ? history.error.message : 'Could not load your history.'}
            </p>
          )}
          {history.isSuccess && runs.length === 0 && <p className="m-0 text-sm text-muted">No runs yet.</p>}
          {runs.length > 0 && <History runs={runs} />}
          {history.hasNextPage && (
            <div>
              <Button onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
                {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </main>
  )
}
