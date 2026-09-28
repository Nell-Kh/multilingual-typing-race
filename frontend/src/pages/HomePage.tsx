import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../features/auth/store'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage, savePracticeLanguage } from '../i18n/languages'
import { ApiError, rooms, type Language } from '../lib/api'
import { dailyBoardQuery, dailyQuery, myStatsQuery } from '../lib/queries'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { Tagline } from '../ui/Tagline'
import { useTitle } from '../ui/useTitle'

const LINK_BUTTON =
  'inline-flex min-h-10 items-center justify-center rounded-control px-4 text-sm font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const PRIMARY = `${LINK_BUTTON} bg-accent text-surface hover:opacity-90`

function EntryCard({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 className="m-0 text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** Signed in: where to go next, in the language you picked. */
export default function HomePage() {
  useTitle()
  const user = useAuth((s) => s.user)
  const navigate = useNavigate()
  const [language, setLanguage] = useState<Language>(loadPracticeLanguage)
  const [code, setCode] = useState('')

  // Same definitions the practice and stats pages use, so they share a cache (ADR-021).
  const today = useQuery(dailyQuery(language))
  const board = useQuery(dailyBoardQuery(language))
  const mine = useQuery(myStatsQuery())

  const create = useMutation({
    mutationFn: () => rooms.create(language, 1),
    onSuccess: (room) => navigate(`/race/${room.code}`),
  })

  function pick(next: Language) {
    savePracticeLanguage(next) // practice, race and daily all start from this
    setLanguage(next)
  }

  function join(e: FormEvent) {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean.length === 6) navigate(`/race/${clean}`)
  }

  const doneToday = board.data?.me ?? null
  const best = mine.data?.languages ?? []

  return (
    <main className="flex flex-col gap-6 p-4 sm:gap-8 sm:p-8">
      <header className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted">
          Welcome back, <strong data-testid="display-name" className="text-ink">{user?.display_name}</strong>
        </p>
        <h1 className="m-0 text-2xl leading-tight font-bold text-balance sm:text-3xl">
          Practise alone, race your friends, or take today&apos;s text.
        </h1>
        <Tagline />
      </header>

      <Segmented
        label="Language"
        value={language}
        onChange={pick}
        options={LANGUAGE_CODES.map((c) => ({ value: c, label: LANGUAGES[c].label, lang: c }))}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <EntryCard title="Practice">
          <p className="m-0 text-sm text-muted">
            A random text at the difficulty you choose, scored when you finish.
          </p>
          <div className="mt-auto">
            <Link to="/practice" className={PRIMARY}>
              Start practice
            </Link>
          </div>
        </EntryCard>

        <EntryCard title="Race">
          <p className="m-0 text-sm text-muted">Open a room and share its code, or join a friend&apos;s.</p>
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Opening…' : 'Create a room'}
          </Button>
          <form onSubmit={join} className="flex gap-2">
            <label className="sr-only" htmlFor="home-room-code">
              Room code
            </label>
            <input
              id="home-room-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC123"
              maxLength={6}
              autoComplete="off"
              className="min-h-10 w-full min-w-0 rounded-control border border-line bg-surface px-3 font-mono tracking-widest uppercase"
            />
            <Button type="submit" disabled={code.trim().length !== 6}>
              Join
            </Button>
          </form>
          {create.isError && (
            <p role="alert" className="m-0 text-sm text-err">
              {create.error instanceof ApiError ? create.error.message : 'Could not open a room'}
            </p>
          )}
        </EntryCard>

        <EntryCard title="Daily" testId={today.data ? 'daily-card' : undefined}>
          {today.isPending && (
            <p className="m-0 text-sm text-muted" aria-busy="true" data-testid="daily-loading">
              Loading today&apos;s challenge…
            </p>
          )}
          {today.isError && (
            // Say it failed rather than leaving a gap: an empty card reads as
            // "there is no daily challenge", not "it did not load".
            <p role="alert" className="m-0 text-sm text-err" data-testid="daily-error">
              {today.error instanceof ApiError && today.error.status === 404
                ? 'No daily challenge in this language yet.'
                : "Could not load today's challenge."}{' '}
              <button
                type="button"
                className="inline-flex min-h-10 items-center font-medium underline"
                onClick={() => void today.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {today.data && (
            <>
              <p
                className="m-0 line-clamp-2 text-ink"
                lang={language}
                dir={LANGUAGES[language].dir}
                data-testid="daily-preview"
              >
                {today.data.text.content}
              </p>
              {doneToday ? (
                <p className="m-0 text-sm" data-testid="daily-done">
                  <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-ok">Done today</span>{' '}
                  #{doneToday.rank} with {doneToday.wpm} wpm
                </p>
              ) : (
                <p className="m-0 text-sm text-muted">The same text for everyone, until midnight.</p>
              )}
              <div className="mt-auto">
                <Link to={`/practice?daily=1&lang=${language}`} className={doneToday ? `${LINK_BUTTON} border border-line text-ink hover:bg-paper` : PRIMARY}>
                  {doneToday ? 'Try it again' : "Type today's text"}
                </Link>
              </div>
            </>
          )}
        </EntryCard>
      </div>

      <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" data-testid="best-row">
        {best.length === 0 ? (
          mine.isPending || mine.isError ? null : (
            <span className="text-muted">
              No runs yet — start with{' '}
              <Link to="/practice" className="font-medium text-accent underline">
                Practice
              </Link>
              .
            </span>
          )
        ) : (
          <>
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Your best</span>
            {best.map((s) => (
              <span key={s.language}>
                <bdi lang={s.language}>{LANGUAGES[s.language].label}</bdi>{' '}
                <strong className="tabular-nums">{s.best_wpm}</strong> <span className="text-muted">wpm</span>
              </span>
            ))}
            <Link to="/stats" className="font-medium text-accent underline">
              All your stats
            </Link>
          </>
        )}
      </p>
    </main>
  )
}
