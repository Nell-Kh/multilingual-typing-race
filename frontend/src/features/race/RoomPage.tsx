import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LANGUAGES, directionOf } from '../../i18n/languages'
import type { KeystrokeLog, RoomPlayer } from '../../lib/api'
import { Button } from '../../ui/Button'
import { useTitle } from '../../ui/useTitle'
import { useAuth } from '../auth/store'
import { reasonText } from '../practice/reasons'
import { initialState, liveStats, reduce } from '../typing-engine/engine'
import { TypingBox } from '../typing-engine/TypingBox'
import type { RaceResultRow } from './protocol'
import { initialRoom, reduceRoom, type RoomView } from './room'
import { RoomSocket } from './socket'

const PROGRESS_EVERY_MS = 250
/** Reconnecting this long without success is shown as a lost connection. */
const LOST_AFTER_MS = 15_000

const LINK_BUTTON =
  'inline-flex min-h-10 items-center justify-center rounded-control px-4 text-sm font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** Why a room cannot be shown, in plain words, with the way out. */
type Problem = 'room_full' | 'no_room' | 'wrong_state' | 'unauthorized' | 'lost' | 'removed' | 'other'

function problemOf(reason: string): Problem {
  if (reason === 'room_full' || reason === 'no_room' || reason === 'wrong_state') return reason
  if (reason === 'unauthorized' || reason === 'invalid token' || reason === 'unknown user') return 'unauthorized'
  return 'other'
}

/**
 * One room, from lobby to results. The socket feeds frames into a pure reducer
 * (room.ts); this component renders that view and sends the four client frames.
 * Timing rule (docs/race-protocol.md §5): keystroke timestamps sent in `finish` are
 * measured from the server's `started`, so reaction time counts and the server-clock
 * check agrees.
 */
export default function RoomPage() {
  const { code: rawCode = '' } = useParams()
  const code = rawCode.toUpperCase()
  useTitle(`Room ${code}`)
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const [view, dispatch] = useReducer(reduceRoom, undefined, initialRoom)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attempt, setAttempt] = useState(0) // bump to reconnect after a lost connection
  const [now, setNow] = useState(() => Date.now())
  const socket = useRef<RoomSocket | null>(null)
  const [everConnected, setEverConnected] = useState(false)

  useEffect(() => {
    const s = new RoomSocket(code, {
      onFrame: (frame) => {
        if (frame.type === 'countdown') setNow(Date.now())
        dispatch({ type: 'frame', frame })
      },
      onConnected: (connected) => {
        if (connected) setEverConnected(true)
        dispatch({ type: 'socket', connected })
      },
      onRejected: (reason) => setProblem(problemOf(reason)),
    })
    socket.current = s
    s.connect()
    return () => {
      s.close()
      socket.current = null
    }
  }, [code, attempt])

  // A socket that keeps failing to come back is a lost connection, not a spinner forever.
  const reconnecting = everConnected && !view.connected
  useEffect(() => {
    if (!reconnecting) return
    const id = setTimeout(() => setProblem((p) => p ?? 'lost'), LOST_AFTER_MS)
    return () => clearTimeout(id)
  }, [reconnecting])

  // Removed from the room while the page is open (the lobby sweep, §6).
  const seenSelf = useRef(false)
  const inRoom = me !== null && view.players.some((p) => p.id === me.id)
  useEffect(() => {
    if (inRoom) seenSelf.current = true
    else if (seenSelf.current && view.connected) setProblem((p) => p ?? 'removed')
  }, [inRoom, view.connected])

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
    const t = performance.now()
    if (t - lastProgress.current < PROGRESS_EVERY_MS) return
    lastProgress.current = t
    const live = liveStats(engine, t)
    socket.current?.send({ type: 'progress', typed: engine.typed.length, errors: live.errors })
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

  // ---- clocks ---------------------------------------------------------------------------
  // `now` drives the 3-2-1 and the live wpm of other players.
  useEffect(() => {
    if (view.state !== 'countdown' && view.state !== 'running') return
    const id = setInterval(() => setNow(Date.now()), view.state === 'countdown' ? 100 : 500)
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

  if (problem) {
    return (
      <ProblemCard
        problem={problem}
        code={code}
        maxPlayers={view.maxPlayers}
        onRetry={() => {
          setProblem(null)
          setEverConnected(false)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }

  const dir = directionOf(view.language)
  const racing = view.state === 'countdown' || view.state === 'running'

  return (
    <main className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-8">
      <RoomHeader view={view} code={code} onLeave={leave} reconnecting={reconnecting} />

      {view.error && (
        <p role="alert" className="m-0 rounded-control bg-err-soft px-3 py-2 text-sm text-err">
          {view.error.message}
        </p>
      )}

      {view.state === 'lobby' && (
        <Lobby view={view} meId={me?.id ?? null} isHost={isHost} onStart={() => socket.current?.send({ type: 'start' })} />
      )}

      {racing && (
        <section aria-label="players" className="flex flex-col gap-2">
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {view.players.map((p) => (
              <ProgressRow key={p.id} player={p} view={view} isMe={p.id === me?.id} dir={dir} now={now} />
            ))}
          </ol>
        </section>
      )}

      {racing && view.text && (
        <div className="relative">
          <TypingBox state={engine} language={view.language} onInput={onInput} locked={view.state !== 'running'} />
          {secondsLeft !== null && (
            <div
              className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-surface/70"
              aria-live="assertive"
            >
              <span data-testid="countdown" className="text-7xl font-bold text-accent tabular-nums sm:text-8xl">
                {secondsLeft > 0 ? secondsLeft : 'Go!'}
              </span>
            </div>
          )}
        </div>
      )}

      {view.state === 'finished' && view.results && (
        <Results
          results={view.results}
          meId={me?.id ?? null}
          isHost={isHost}
          onPlayAgain={() => socket.current?.send({ type: 'play_again' })}
          onLeave={leave}
        />
      )}
    </main>
  )
}

// ---- pieces ---------------------------------------------------------------------------------

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(id)
  }, [copied])
  return [
    copied,
    (key, text) => {
      // The clipboard can be unavailable (http, permissions); the code stays on screen.
      void navigator.clipboard?.writeText(text).then(
        () => setCopied(key),
        () => setCopied(null),
      )
    },
  ]
}

function RoomHeader({
  view,
  code,
  onLeave,
  reconnecting,
}: {
  view: RoomView
  code: string
  onLeave: () => void
  reconnecting: boolean
}) {
  const [copied, copy] = useCopy()
  const link = `${window.location.origin}/race/${code}`
  // During the race the header shrinks to one line, so the text stays high on a
  // phone screen, above the keyboard.
  if (view.state === 'countdown' || view.state === 'running') {
    return (
      <header className="flex items-center justify-between gap-3">
        <p className="m-0 min-w-0 truncate text-sm text-muted">
          Room <span data-testid="room-code" className="font-mono font-bold tracking-widest text-ink">{code}</span> ·{' '}
          <bdi lang={view.language}>{LANGUAGES[view.language].label}</bdi> ·{' '}
          <span data-testid="seats">
            {view.players.length}
            {view.maxPlayers === null ? '' : `/${view.maxPlayers}`} players
          </span>
          {reconnecting && <span className="ms-2 font-medium text-err">Reconnecting…</span>}
        </p>
        <Button onClick={onLeave}>Leave</Button>
      </header>
    )
  }
  return (
    <header className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 text-xs font-medium tracking-wide text-muted uppercase">Room code</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 font-mono text-3xl font-bold tracking-[0.2em] sm:text-4xl" data-testid="room-code">
            {code}
          </h1>
          <Button onClick={() => copy('code', code)} aria-live="polite">
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </Button>
          <Button variant="ghost" onClick={() => copy('link', link)}>
            {copied === 'link' ? 'Link copied' : 'Copy link'}
          </Button>
        </div>
        <p className="m-0 text-sm text-muted">
          <bdi lang={view.language}>{LANGUAGES[view.language].label}</bdi> · difficulty {view.difficulty} ·{' '}
          <span data-testid="seats">
            {view.players.length}
            {view.maxPlayers === null ? '' : `/${view.maxPlayers}`} players
          </span>
          {reconnecting && <span className="ms-2 font-medium text-err">Reconnecting…</span>}
        </p>
      </div>
      {/* Once the race is over the results card has its own Leave, next to Play again. */}
      {view.state !== 'finished' && (
        <Button onClick={onLeave} className="self-start sm:self-center">
          Leave
        </Button>
      )}
    </header>
  )
}

function Avatar({ name, highlight = false }: { name: string; highlight?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold
        ${highlight ? 'bg-accent text-surface' : 'bg-accent-soft text-accent'}`}
    >
      {initial(name)}
    </span>
  )
}

function Lobby({
  view,
  meId,
  isHost,
  onStart,
}: {
  view: RoomView
  meId: string | null
  isHost: boolean
  onStart: () => void
}) {
  const enough = view.players.length >= 2
  return (
    <section aria-label="lobby" className="flex flex-col gap-4">
      <ol aria-label="players" className="m-0 flex list-none flex-col gap-2 p-0">
        {view.players.map((p) => (
          <li
            key={p.id}
            data-testid={`player-${p.id}`}
            className={`flex min-h-12 items-center gap-3 rounded-card border px-4 py-2
              ${p.id === meId ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface'}`}
          >
            <Avatar name={p.display_name} highlight={p.id === meId} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {p.display_name}
              {p.id === meId && <span className="ms-1 font-normal text-muted">(you)</span>}
            </span>
            {p.id === view.hostId && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">host</span>
            )}
            <span className={`text-xs font-medium ${p.connected ? 'text-ok' : 'text-err'}`}>
              {p.connected ? 'connected' : 'reconnecting…'}
            </span>
          </li>
        ))}
      </ol>

      {isHost ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onStart} disabled={!enough} className="min-h-11 px-6 text-base">
            Start race
          </Button>
          {!enough && (
            <p className="m-0 text-sm text-muted" data-testid="start-reason">
              A race needs at least 2 players. Share the code to invite someone.
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 text-muted">Waiting for the host to start…</p>
      )}
    </section>
  )
}

function ProgressRow({
  player: p,
  view,
  isMe,
  dir,
  now,
}: {
  player: RoomPlayer
  view: RoomView
  isMe: boolean
  dir: 'ltr' | 'rtl'
  now: number
}) {
  const total = view.text?.char_count ?? 0
  const pct = total ? Math.min(100, Math.round((p.typed / total) * 100)) : 0
  // Live speed from progress frames: advisory, like the bar. The final number is the server's.
  const since = view.startedSeenAt ? (now - Date.parse(view.startedSeenAt)) / 60_000 : 0
  const liveWpm = since > 0 ? Math.round(p.typed / 5 / since) : 0
  const status = p.place
    ? `#${p.place} · ${p.wpm} wpm`
    : p.finished_at
      ? 'not counted'
      : view.state === 'running'
        ? `${liveWpm} wpm`
        : ''

  return (
    <li
      data-testid={`player-${p.id}`}
      className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-card border px-3 py-2
        sm:grid-cols-[2rem_9rem_minmax(0,1fr)_7rem]
        ${isMe ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface'}`}
    >
      <Avatar name={p.display_name} highlight={isMe} />
      <span className="truncate text-sm font-medium">
        {p.display_name}
        {!p.connected && <span className="ms-1 text-xs font-normal text-err">away</span>}
      </span>
      {/* The bar fills from the start edge of the text's direction: right to left in Hebrew and Arabic. */}
      <div
        dir={dir}
        data-testid={`bar-${p.id}`}
        className="col-span-3 row-start-2 h-2.5 overflow-hidden rounded-full border border-line bg-paper sm:col-span-1 sm:row-start-auto"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${p.valid === false ? 'bg-err' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${p.display_name} progress`}
        />
      </div>
      <span className="col-start-3 row-start-1 text-end text-sm font-medium tabular-nums sm:col-start-auto sm:row-start-auto">
        {status}
      </span>
    </li>
  )
}

function Results({
  results,
  meId,
  isHost,
  onPlayAgain,
  onLeave,
}: {
  results: RaceResultRow[]
  meId: string | null
  isHost: boolean
  onPlayAgain: () => void
  onLeave: () => void
}) {
  // Every time and every reason is the server's, the same for everyone in the room (ADR-033).
  function timeOf(r: RaceResultRow): string {
    return r.dnf || r.duration_ms === null ? '–' : seconds(r.duration_ms)
  }

  function statusOf(r: RaceResultRow): ReactNode {
    if (r.dnf) return <span className="text-muted">did not finish</span>
    if (r.valid === false || (r.place === null && !r.dnf)) {
      return (
        <span className="text-err">
          not counted
          {r.reason && (
            <span className="block text-xs text-muted" data-testid={`result-reason-${r.player_id}`}>
              {reasonText(r.reason)}
            </span>
          )}
        </span>
      )
    }
    return <span className="text-ok">counted</span>
  }

  return (
    <section aria-label="results" className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 sm:p-8">
      <h2 className="m-0 text-2xl font-bold">Results</h2>
      {/* Phones get one card per player; the table needs more width than they have. */}
      <ol className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden">
        {results.map((r) => (
          <li
            key={r.player_id}
            data-testid={`result-card-${r.player_id}`}
            className={`flex items-start gap-3 rounded-card border px-3 py-2 ${r.player_id === meId ? 'border-accent bg-accent-soft/40' : 'border-line'}`}
          >
            <span className="w-8 shrink-0 pt-1 text-lg font-bold tabular-nums">{r.place ? `#${r.place}` : '–'}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                <Avatar name={r.display_name} highlight={r.player_id === meId} />
                <span className="truncate">{r.display_name}</span>
              </span>
              <span className="text-sm tabular-nums text-muted">
                {r.wpm !== null ? `${r.wpm} wpm · ${r.accuracy}% · ${timeOf(r)}` : timeOf(r)}
              </span>
              <span className="text-sm">{statusOf(r)}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
              <th className="py-2 pe-3 text-start font-medium">Place</th>
              <th className="py-2 pe-3 text-start font-medium">Player</th>
              <th className="py-2 pe-3 text-end font-medium">WPM</th>
              <th className="py-2 pe-3 text-end font-medium">Accuracy</th>
              <th className="py-2 pe-3 text-end font-medium">Time</th>
              <th className="py-2 text-start font-medium">Counted</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.player_id}
                data-testid={`result-${r.player_id}`}
                className={`border-b border-line last:border-b-0 ${r.player_id === meId ? 'bg-accent-soft/40' : ''}`}
              >
                <td className="py-3 pe-3 text-lg font-bold tabular-nums">{r.place ? `#${r.place}` : r.dnf ? 'dnf' : '–'}</td>
                <td className="py-3 pe-3 font-medium">
                  <span className="flex items-center gap-2">
                    <Avatar name={r.display_name} highlight={r.player_id === meId} />
                    {r.display_name}
                  </span>
                </td>
                <td className="py-3 pe-3 text-end tabular-nums">{r.wpm ?? '–'}</td>
                <td className="py-3 pe-3 text-end tabular-nums">{r.accuracy !== null ? `${r.accuracy}%` : '–'}</td>
                <td className="py-3 pe-3 text-end tabular-nums">{timeOf(r)}</td>
                <td className="py-3">{statusOf(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-muted">
        Places, speeds and times are the server&apos;s.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {isHost ? (
          <Button variant="primary" onClick={onPlayAgain}>
            Play again
          </Button>
        ) : (
          <p className="m-0 text-sm text-muted">The host can start another race.</p>
        )}
        <Button onClick={onLeave}>Leave</Button>
        <Link to="/" className={`${LINK_BUTTON} text-accent hover:bg-accent-soft`}>
          Back to home
        </Link>
      </div>
    </section>
  )
}

const PROBLEMS: Record<Problem, { title: string; body: (code: string, max: number | null) => string }> = {
  room_full: {
    title: 'This room is full',
    body: (code, max) =>
      `Room ${code} already has ${max ?? 'the most'} players. Ask the host to start a new room, or open your own.`,
  },
  no_room: {
    title: 'No room with this code',
    body: (code) =>
      `There is no room ${code}. The code may be mistyped, or the room closed: rooms close after 10 minutes with no one in them.`,
  },
  wrong_state: {
    title: 'This race has already started',
    body: (code) => `Room ${code} is mid-race, and players can only join in the lobby. Wait for it to finish, or open your own room.`,
  },
  unauthorized: {
    title: 'Your session has ended',
    body: () => 'Log in again to join the room.',
  },
  lost: {
    title: 'Connection lost',
    body: () =>
      'The connection to the room dropped and has not come back. If a race was running, your place is kept until it ends.',
  },
  removed: {
    title: 'You are no longer in this room',
    body: () => 'You were away from the lobby for too long, so the room let your seat go.',
  },
  other: {
    title: 'Could not open this room',
    body: () => 'Something went wrong while joining. Try again, or go back and open a new room.',
  },
}

function ProblemCard({
  problem,
  code,
  maxPlayers,
  onRetry,
}: {
  problem: Problem
  code: string
  maxPlayers: number | null
  onRetry: () => void
}) {
  const p = PROBLEMS[problem]
  const primary = `${LINK_BUTTON} bg-accent text-surface hover:opacity-90`
  const secondary = `${LINK_BUTTON} border border-line bg-surface text-ink hover:bg-paper`
  return (
    <main className="flex justify-center p-4 py-10 sm:py-16">
      <section
        role="alert"
        data-testid={`problem-${problem}`}
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-surface p-6 sm:p-8"
      >
        <h1 className="m-0 text-2xl font-bold">{p.title}</h1>
        <p className="m-0 text-muted">{p.body(code, maxPlayers)}</p>
        <div className="flex flex-wrap gap-3">
          {problem === 'unauthorized' ? (
            <Link to="/login" className={primary}>
              Log in
            </Link>
          ) : problem === 'lost' || problem === 'removed' || problem === 'other' ? (
            <Button variant="primary" onClick={onRetry}>
              {problem === 'removed' ? 'Rejoin' : 'Try again'}
            </Button>
          ) : (
            <Link to="/race" className={primary}>
              Open a room
            </Link>
          )}
          <Link to="/" className={secondary}>
            Back to home
          </Link>
        </div>
      </section>
    </main>
  )
}
