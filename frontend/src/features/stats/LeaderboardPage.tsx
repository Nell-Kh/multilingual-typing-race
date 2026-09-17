import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage } from '../../i18n/languages'
import { ApiError, leaderboards, type Language, type Period } from '../../lib/api'
import { useAuth } from '../auth/store'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All time' },
]

export default function LeaderboardPage() {
  const me = useAuth((s) => s.user)
  const [language, setLanguage] = useState<Language>(loadPracticeLanguage)
  const [period, setPeriod] = useState<Period>('week')
  const board = useQuery({
    queryKey: ['leaderboard', language, period],
    queryFn: () => leaderboards.get(language, period),
  })
  const inTop = board.data?.rows.some((r) => r.user_id === me?.id) ?? false

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" to="/stats">
            Your stats
          </Link>
          <Link className="underline" to="/">
            Home
          </Link>
        </nav>
      </header>

      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Language">
        {LANGUAGE_CODES.map((c) => (
          <button
            key={c}
            type="button"
            lang={c}
            onClick={() => setLanguage(c)}
            className={`rounded border px-3 py-1 ${c === language ? 'bg-blue-600 text-white' : ''}`}
            aria-pressed={c === language}
          >
            {LANGUAGES[c].label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`rounded border px-3 py-1 ${p.value === period ? 'bg-blue-600 text-white' : ''}`}
            aria-pressed={p.value === period}
          >
            {p.label}
          </button>
        ))}
      </div>

      {board.isPending && <p>Loading…</p>}
      {board.isError && (
        <p role="alert" className="text-red-600">
          {board.error instanceof ApiError ? board.error.message : 'Could not load the leaderboard'}
        </p>
      )}
      {board.data && board.data.rows.length === 0 && (
        <p className="text-gray-500">No counted runs in this period yet. Be the first.</p>
      )}
      {board.data && board.data.rows.length > 0 && (
        <table className="w-full max-w-2xl text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="text-start">#</th>
              <th className="text-start">player</th>
              <th className="text-end">wpm</th>
              <th className="text-end">accuracy</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {board.data.rows.map((r) => (
              <tr
                key={r.user_id}
                data-testid={`row-${r.rank}`}
                className={r.user_id === me?.id ? 'bg-blue-50 dark:bg-blue-950' : ''}
              >
                <td>{r.rank}</td>
                <td className="font-sans">
                  {r.display_name}
                  {r.user_id === me?.id && <span className="ms-1 text-xs text-gray-500">(you)</span>}
                </td>
                <td className="text-end">{r.wpm}</td>
                <td className="text-end">{r.accuracy}%</td>
              </tr>
            ))}
            {board.data.me && !inTop && (
              <tr data-testid="row-me" className="bg-blue-50 dark:bg-blue-950">
                <td>{board.data.me.rank}</td>
                <td className="font-sans">
                  {board.data.me.display_name}
                  <span className="ms-1 text-xs text-gray-500">(you)</span>
                </td>
                <td className="text-end">{board.data.me.wpm}</td>
                <td className="text-end">{board.data.me.accuracy}%</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  )
}
