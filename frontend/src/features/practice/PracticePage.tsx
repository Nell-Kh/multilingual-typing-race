import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useReducer, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/store'
import { ApiError, sessions, texts, type Language, type SessionResult } from '../../lib/api'
import { initialState, liveStats, reduce } from '../typing-engine/engine'
import { TypingBox } from '../typing-engine/TypingBox'
import { ResultsCard } from './ResultsCard'

type Difficulty = 1 | 2 | 3

export default function PracticePage() {
  const user = useAuth((s) => s.user)
  const [difficulty, setDifficulty] = useState<Difficulty>(1)
  const [attempt, setAttempt] = useState(0) // bump to fetch a new text
  const language: Language = 'en' // he/ar arrive in M3

  const text = useQuery({
    queryKey: ['texts', 'random', language, difficulty, attempt],
    queryFn: () => texts.random(language, difficulty),
    staleTime: Infinity,
    retry: false,
  })

  const [engine, dispatch] = useReducer(reduce, initialState(''))
  useEffect(() => {
    if (text.data) dispatch({ type: 'reset', target: text.data.content })
  }, [text.data])

  const submit = useMutation({
    mutationFn: async (): Promise<SessionResult> => {
      if (!text.data || engine.startedAt === null) throw new Error('nothing to submit')
      // startedAt is a monotonic clock; convert to wall-clock for the server.
      const startedAt = new Date(Date.now() - (performance.now() - engine.startedAt))
      return sessions.submit(text.data.id, startedAt.toISOString(), engine.keystrokes)
    },
  })

  useEffect(() => {
    if (engine.finished && submit.isIdle) submit.mutate()
  }, [engine.finished, submit])

  // Tick once a second for the live timer while typing.
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (engine.startedAt === null || engine.finished) return
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [engine.startedAt, engine.finished])
  const stats = liveStats(engine, now)

  function next() {
    submit.reset()
    setAttempt((n) => n + 1)
  }

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Practice</h1>
        <nav className="flex items-center gap-4 text-sm">
          <span>{user?.display_name}</span>
          <Link className="underline" to="/">
            Home
          </Link>
        </nav>
      </header>

      <div className="flex items-center gap-3">
        <span className="text-sm">Difficulty</span>
        {([1, 2, 3] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDifficulty(d)
              next()
            }}
            className={`rounded border px-3 py-1 ${d === difficulty ? 'bg-blue-600 text-white' : ''}`}
            aria-pressed={d === difficulty}
          >
            {d}
          </button>
        ))}
      </div>

      {text.isPending && <p>Loading text…</p>}
      {text.isError && (
        <p role="alert" className="text-red-600">
          {text.error instanceof ApiError ? text.error.message : 'Could not load a text'}
        </p>
      )}

      {text.data && (
        <>
          <TypingBox state={engine} onInput={(value, at) => dispatch({ type: 'input', value, at })} />
          <dl className="flex gap-8 font-mono text-sm" aria-label="live stats">
            <div>
              <dt className="text-gray-500">time</dt>
              <dd data-testid="live-time">{(stats.elapsedMs / 1000).toFixed(1)}s</dd>
            </div>
            <div>
              <dt className="text-gray-500">wpm</dt>
              <dd data-testid="live-wpm">{stats.wpm}</dd>
            </div>
            <div>
              <dt className="text-gray-500">accuracy</dt>
              <dd data-testid="live-accuracy">{stats.accuracy}%</dd>
            </div>
            <div>
              <dt className="text-gray-500">errors</dt>
              <dd data-testid="live-errors">{stats.errors}</dd>
            </div>
          </dl>
          <p className="text-xs text-gray-500">
            {text.data.source} · {text.data.license}
          </p>
        </>
      )}

      {submit.isPending && <p>Scoring…</p>}
      {submit.isError && (
        <div role="alert" className="flex items-center gap-4 text-red-600">
          <span>
            {submit.error instanceof ApiError
              ? submit.error.message
              : 'Could not reach the server to save the session'}
          </span>
          <button
            type="button"
            onClick={() => submit.mutate()}
            className="rounded border border-current px-3 py-1 text-sm"
          >
            Retry
          </button>
        </div>
      )}
      {submit.data && <ResultsCard result={submit.data} onNext={next} />}
    </main>
  )
}
