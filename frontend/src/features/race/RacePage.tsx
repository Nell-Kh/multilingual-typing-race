import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { LANGUAGES, LANGUAGE_CODES, loadPracticeLanguage } from '../../i18n/languages'
import { ApiError, rooms, type Language } from '../../lib/api'
import { Button } from '../../ui/Button'
import { Segmented } from '../../ui/Segmented'
import { useTitle } from '../../ui/useTitle'

type Difficulty = 1 | 2 | 3

/** Entry point for races: open a room, or join one by its six-letter code. */
export default function RacePage() {
  useTitle('Race')
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
    <main className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">Race</h1>
        <p className="m-0 text-sm text-muted">
          Up to five friends, one text, places decided by the server from each keystroke log.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6"
          aria-labelledby="create-heading"
        >
          <h2 id="create-heading" className="m-0 text-lg font-bold">
            Open a room
          </h2>
          <Segmented
            label="Language"
            value={language}
            onChange={setLanguage}
            options={LANGUAGE_CODES.map((c) => ({ value: c, label: LANGUAGES[c].label, lang: c }))}
          />
          <Segmented
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={([1, 2, 3] as const).map((d) => ({ value: d, label: d }))}
          />
          <div>
            <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending} className="min-h-11 px-6">
              {create.isPending ? 'Opening…' : 'Create room'}
            </Button>
          </div>
          {create.isError && (
            <p role="alert" className="m-0 text-sm text-err">
              {create.error instanceof ApiError ? create.error.message : 'Could not create a room'}
            </p>
          )}
        </section>

        <form
          onSubmit={join}
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6"
          aria-labelledby="join-heading"
        >
          <h2 id="join-heading" className="m-0 text-lg font-bold">
            Join a room
          </h2>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Room code</span>
            <input
              className="min-h-12 rounded-control border border-line bg-surface px-3 font-mono text-2xl tracking-[0.2em] uppercase
                focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              placeholder="ABC123"
            />
          </label>
          <p className="m-0 text-sm text-muted">The six letters the host shares with you.</p>
          <div>
            <Button type="submit" disabled={code.trim().length !== 6} className="min-h-11 px-6">
              Join
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
