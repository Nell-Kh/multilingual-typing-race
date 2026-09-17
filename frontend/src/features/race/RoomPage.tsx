import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LANGUAGES } from '../../i18n/languages'
import type { KeystrokeLog } from '../../lib/api'
import { useAuth } from '../auth/store'
import { initialState, liveStats, reduce } from '../typing-engine/engine'
import { TypingBox } from '../typing-engine/TypingBox'
import { initialRoom, reduceRoom } from './room'
import { RoomSocket } from './socket'

const PROGRESS_EVERY_MS = 250

/**
 * One room, from lobby to results. The socket feeds frames into a pure reducer
 * (room.ts); this component renders that view and sends the four client frames.
 * Timing rule (docs/race-protocol.md §5): keystroke timestamps sent in `finish` are
 * measured from the server's `started`, so reaction time counts and the server-clock
 * check agrees.
 */
export default function RoomPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const [view, dispatch] = useReducer(reduceRoom, undefined, initialRoom)
  const [rejected, setRejected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const socket = useRef<RoomSocket | null>(null)

  useEffect(() => {
    const s = new RoomSocket(code, {
      onFrame: (frame) => {
        if (frame.type === 'countdown') setNow(Date.now())
        dispatch({ type: 'frame', frame })
      },
      onConnected: (connected) => dispatch({ type: 'socket', connected }),
      onRejected: setRejected,
    })
    socket.current = s
    s.connect()
    return () => {
      s.close()
      socket.current = null
    }
  }, [code])

  // ---- typing --------------------------------------------------------------------
  const [engine, engineDispatch] = useReducer(reduce, initialState(''))
  const raceStartPerf = useRef<number | null>(null)
  const sentFinish = useRef(false)
  const lastProgress = useRef(0)

  useEffect(() => {
    // A new text (countdown, or a snapshot after reconnecting) resets the engine.
    engineDispatch({ type: 'reset', target: view.text?.content ?? '' })
    sentFinish.current = false
  }, [view.text?.id, view.text?.content])

  useEffect(() => {
    if (view.state !== 'running' || view.startedAt === null) {
      raceStartPerf.current = null
      return
    }
    // performance.now() at the moment the server said "go" — exact if we were
    // connected then, estimated from wall-clock if we reconnected mid-race.
    const sinceStartMs = Date.now() - Date.parse(view.startedAt)
    raceStartPerf.current = performance.now() - Math.max(0, sinceStartMs)
  }, [view.state, view.startedAt])

  const onInput = useCallback(
    (value: string, at: number) => {
      engineDispatch({ type: 'input', value, at })
    },
    [engineDispatch],
  )

  // Progress (advisory, throttled) while typing.
  useEffect(() => {
    if (view.state !== 'running' || engine.startedAt === null || engine.finished) return
    const now = performance.now()
    if (now - lastProgress.current < PROGRESS_EVERY_MS) return
    lastProgress.current = now
    const stats = liveStats(engine, now)
    socket.current?.send({ type: 'progress', typed: engine.typed.length, errors: stats.errors })
  }, [engine, view.state])

  // The finish frame: the whole log, shifted so t=0 is the server's `started`.
  useEffect(() => {
    if (!engine.finished || sentFinish.current || view.startedAt === null) return
    if (engine.startedAt === null || raceStartPerf.current === null) return
    sentFinish.current = true
    const reactionMs = Math.max(0, Math.round(engine.startedAt - raceStartPerf.current))
    const keystrokes: KeystrokeLog = engine.keystrokes.map(([t, e, ty]) => [t + reactionMs, e, ty])
    socket.current?.send({ type: 'finish', started_at: view.startedAt, keystrokes })
  }, [engine, view.startedAt])

  // ---- countdown ticker ---------------------------------------------------------------
  // `now` is refreshed by the socket event that starts the countdown (so the first
  // paint is right) and then every 100 ms while it runs.
  useEffect(() => {
    if (view.state !== 'countdown') return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [view.state])
  const secondsLeft =
    view.state === 'countdown' && view.startsAt
      ? Math.max(0, Math.ceil((Date.parse(view.startsAt) - now) / 1000))
      : null

  // ---- actions --------------------------------------------------------------------------
  const isHost = me !== null && view.hostId === me.id
  function leave() {
    socket.current?.send({ type: 'leave' })
    navigate('/race')
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      /* clipboard can be unavailable (http, permissions); the code is still on screen */
    }
  }

  if (rejected) {
    return (
      <main className="flex flex-col items-center gap-4 p-8">
        <p role="alert" className="text-red-600">
          Could not join room {code}: {rejected}
        </p>
        <Link className="underline" to="/race">
          Back to races
        </Link>
      </main>
    )
  }

  const total = view.text?.char_count ?? 0

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Room <span className="font-mono tracking-widest">{code}</span>
        </h1>
        <div className="flex items-center gap-4 text-sm">
          {!view.connected && <span className="text-amber-600">reconnecting…</span>}
          <button type="button" className="underline" onClick={copyCode}>
            Copy code
          </button>
          <button type="button" className="underline" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      <p className="text-sm text-gray-500">
        {LANGUAGES[view.language].label} · difficulty {view.difficulty} · {view.players.length}/5 players
      </p>

      {view.error && (
        <p role="alert" className="text-sm text-red-600">
          {view.error.message}
        </p>
      )}

      <ol className="flex flex-col gap-2" aria-label="players">
        {view.players.map((p) => {
          const pct = total ? Math.min(100, Math.round((p.typed / total) * 100)) : 0
          return (
            <li key={p.id} className="flex items-center gap-3" data-testid={`player-${p.id}`}>
              <span className="w-40 truncate">
                {p.display_name}
                {p.id === view.hostId && <span className="ms-1 text-xs text-gray-500">(host)</span>}
                {!p.connected && <span className="ms-1 text-xs text-amber-600">(away)</span>}
              </span>
              <div className="h-3 flex-1 rounded bg-gray-200 dark:bg-gray-700">
                <div
                  className={`h-3 rounded ${p.valid === false ? 'bg-red-400' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${p.display_name} progress`}
                />
              </div>
              <span className="w-40 text-end font-mono text-sm">
                {p.place ? `#${p.place} · ${p.wpm} wpm` : p.finished_at ? 'not counted' : `${pct}%`}
              </span>
            </li>
          )
        })}
      </ol>

      {view.state === 'lobby' &&
        (isHost ? (
          <button
            type="button"
            onClick={() => socket.current?.send({ type: 'start' })}
            className="self-start rounded bg-blue-600 px-6 py-3 text-lg text-white"
          >
            Start race
          </button>
        ) : (
          <p className="text-gray-500">Waiting for the host to start…</p>
        ))}

      {secondsLeft !== null && (
        <p className="text-4xl font-bold" data-testid="countdown" aria-live="assertive">
          {secondsLeft > 0 ? secondsLeft : 'Go!'}
        </p>
      )}

      {view.text && (view.state === 'countdown' || view.state === 'running') && (
        <TypingBox
          state={engine}
          language={view.language}
          onInput={onInput}
          locked={view.state !== 'running'}
        />
      )}

      {view.state === 'finished' && view.results && (
        <section aria-label="results" className="rounded-lg border p-6">
          <h2 className="mb-4 text-xl font-bold">Results</h2>
          <table className="w-full text-start">
            <thead className="text-sm text-gray-500">
              <tr>
                <th className="text-start">place</th>
                <th className="text-start">player</th>
                <th className="text-end">wpm</th>
                <th className="text-end">accuracy</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {view.results.map((r) => (
                <tr key={r.player_id} data-testid={`result-${r.player_id}`}>
                  <td>{r.place ? `#${r.place}` : r.dnf ? 'dnf' : 'not counted'}</td>
                  <td className="font-sans">{r.display_name}</td>
                  <td className="text-end">{r.wpm ?? '–'}</td>
                  <td className="text-end">{r.accuracy !== null ? `${r.accuracy}%` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isHost ? (
            <button
              type="button"
              onClick={() => socket.current?.send({ type: 'play_again' })}
              className="mt-6 rounded bg-blue-600 px-4 py-2 text-white"
            >
              Play again
            </button>
          ) : (
            <p className="mt-6 text-gray-500">The host can start another race.</p>
          )}
        </section>
      )}
    </main>
  )
}
