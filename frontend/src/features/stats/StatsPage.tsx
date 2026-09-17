import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { LANGUAGES } from '../../i18n/languages'
import { ApiError, stats, type SessionSummary } from '../../lib/api'
import { Trend } from './Trend'

function minutes(ms: number): string {
  const m = Math.round(ms / 60000)
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function StatsPage() {
  const me = useQuery({ queryKey: ['me', 'stats'], queryFn: stats.me })
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
                  <dd>{minutes(s.total_time_ms)}</dd>
                </dl>
              </div>
            ))}
          </section>

          <section aria-label="trend">
            <h2 className="mb-2 font-semibold">Recent runs</h2>
            <Trend points={me.data.trend} />
          </section>
        </>
      )}

      <section aria-label="history">
        <h2 className="mb-2 font-semibold">History</h2>
        {runs.length === 0 && !history.isPending && <p className="text-sm text-gray-500">Nothing yet.</p>}
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
