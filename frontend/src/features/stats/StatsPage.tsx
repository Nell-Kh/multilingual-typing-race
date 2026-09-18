import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage } from '../../i18n/languages'
import { ApiError, stats, type Language, type SessionSummary } from '../../lib/api'
import { Heatmap } from './Heatmap'
import { Trend } from './Trend'

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

export default function StatsPage() {
  const me = useQuery({ queryKey: ['me', 'stats'], queryFn: stats.me })
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

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your stats</h1>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" to="/leaderboard">
            Leaderboard
          </Link>
          <Link className="underline" to="/">
            Home
          </Link>
        </nav>
      </header>

      {me.isPending && <p>Loading…</p>}
      {me.isError && (
        <p role="alert" className="text-red-600">
          {me.error instanceof ApiError ? me.error.message : 'Could not load stats'}
        </p>
      )}

      {me.data && me.data.languages.length === 0 && (
        <p className="text-gray-500">
          No counted runs yet.{' '}
          <Link className="underline" to="/practice">
            Practice
          </Link>{' '}
          and come back.
        </p>
      )}

      {me.data && me.data.languages.length > 0 && (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="per language">
            {me.data.languages.map((s) => (
              <div key={s.language} className="rounded-lg border p-4" data-testid={`lang-${s.language}`}>
                <h2 className="mb-2 font-semibold" lang={s.language}>
                  {LANGUAGES[s.language].label}
                </h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
                  <dt className="text-gray-500">best</dt>
                  <dd>{s.best_wpm} wpm</dd>
                  <dt className="text-gray-500">average</dt>
                  <dd>{s.avg_wpm} wpm</dd>
                  <dt className="text-gray-500">accuracy</dt>
                  <dd>{s.avg_accuracy}%</dd>
                  <dt className="text-gray-500">runs</dt>
                  <dd>{s.runs}</dd>
                  <dt className="text-gray-500">time</dt>
                  <dd>{duration(s.total_time_ms)}</dd>
                </dl>
              </div>
            ))}
          </section>

          <section aria-label="trend">
            <h2 className="mb-2 font-semibold">Recent runs</h2>
            <Trend points={me.data.trend} />
          </section>

          <section aria-label="keyboard">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">Weak keys</h2>
              <div className="flex gap-2" role="group" aria-label="Keyboard language">
                {LANGUAGE_CODES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    lang={c}
                    onClick={() => setPicked(c)}
                    className={`rounded border px-2 py-0.5 text-sm ${c === keyLang ? 'bg-blue-600 text-white' : ''}`}
                    aria-pressed={c === keyLang}
                  >
                    {LANGUAGES[c].label}
                  </button>
                ))}
              </div>
            </div>
            {keys.isPending && <p className="text-sm text-gray-500">Loading…</p>}
            {keys.isError && (
              <p role="alert" className="text-sm text-red-600">
                {keys.error instanceof ApiError ? keys.error.message : 'Could not load your keys'}
              </p>
            )}
            {keys.data && <Heatmap language={keyLang} keys={keys.data.keys} />}
          </section>
        </>
      )}

      <section aria-label="history">
        <h2 className="mb-2 font-semibold">History</h2>
        {history.isError && (
          <p role="alert" className="text-sm text-red-600">
            {history.error instanceof ApiError ? history.error.message : 'Could not load your history'}
          </p>
        )}
        {runs.length === 0 && !history.isPending && !history.isError && (
          <p className="text-sm text-gray-500">Nothing yet.</p>
        )}
        {runs.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-start text-gray-500">
              <tr>
                <th className="text-start">when</th>
                <th className="text-start">language</th>
                <th className="text-start">mode</th>
                <th className="text-end">wpm</th>
                <th className="text-end">accuracy</th>
                <th className="text-end">counted</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {runs.map((r) => (
                <tr key={r.id} data-testid={`run-${r.id}`}>
                  <td className="font-sans">{when(r.started_at)}</td>
                  <td>{r.language}</td>
                  <td>{r.mode}</td>
                  <td className="text-end">{r.wpm}</td>
                  <td className="text-end">{r.accuracy}%</td>
                  <td className="text-end">{r.is_valid ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {history.hasNextPage && (
          <button
            type="button"
            className="mt-4 rounded border px-4 py-2 text-sm"
            onClick={() => void history.fetchNextPage()}
            disabled={history.isFetchingNextPage}
          >
            Load more
          </button>
        )}
      </section>
    </main>
  )
}
