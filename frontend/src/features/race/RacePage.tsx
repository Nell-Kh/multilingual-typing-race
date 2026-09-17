import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage } from '../../i18n/languages'
import { ApiError, rooms, type Language } from '../../lib/api'

type Difficulty = 1 | 2 | 3

/** Entry point for races: open a room, or join one by its six-letter code. */
export default function RacePage() {
  const navigate = useNavigate()
  const [language, setLanguage] = useState<Language>(loadPracticeLanguage)
  const [difficulty, setDifficulty] = useState<Difficulty>(1)
  const [code, setCode] = useState('')

  const create = useMutation({
    mutationFn: () => rooms.create(language, difficulty),
    onSuccess: (room) => navigate(`/race/${room.code}`),
  })

  function join(e: FormEvent) {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean.length === 6) navigate(`/race/${clean}`)
  }

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Race</h1>
        <Link className="text-sm underline" to="/">
          Home
        </Link>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border p-6" aria-labelledby="create-heading">
        <h2 id="create-heading" className="text-lg font-semibold">
          Open a room
        </h2>
        <div className="flex items-center gap-3" role="group" aria-label="Language">
          <span className="text-sm">Language</span>
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
        <div className="flex items-center gap-3" role="group" aria-label="Difficulty">
          <span className="text-sm">Difficulty</span>
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              className={`rounded border px-3 py-1 ${d === difficulty ? 'bg-blue-600 text-white' : ''}`}
              aria-pressed={d === difficulty}
            >
              {d}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="self-start rounded bg-blue-600 px-6 py-3 text-lg text-white disabled:opacity-50"
        >
          Create room
        </button>
        {create.isError && (
          <p role="alert" className="text-sm text-red-600">
            {create.error instanceof ApiError ? create.error.message : 'Could not create a room'}
          </p>
        )}
      </section>

      <form onSubmit={join} className="flex flex-col gap-4 rounded-lg border p-6" aria-labelledby="join-heading">
        <h2 id="join-heading" className="text-lg font-semibold">
          Join a room
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Room code</span>
          <input
            className="rounded border px-3 py-2 font-mono text-xl uppercase tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC123"
          />
        </label>
        <button
          type="submit"
          disabled={code.trim().length !== 6}
          className="self-start rounded border px-6 py-3 text-lg disabled:opacity-50"
        >
          Join
        </button>
      </form>
    </main>
  )
}
