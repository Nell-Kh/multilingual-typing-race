// The typing engine: a pure reducer. No DOM, no timers, no React — which is what
// makes it unit-testable and what M3 will reuse unchanged under an RTL renderer.
//
// The browser gives us the *whole* input value on every change. We diff it against
// what we had and turn the difference into keystrokes in the exact format the
// backend scores: [t_ms, expected, typed], with "\b" for backspace.

export const BACKSPACE = '\b'

/** [milliseconds since first keystroke, expected char ("" for backspace), typed char] */
export type Keystroke = [number, string, string]

export interface EngineState {
  /** The normalized text the user must reproduce. */
  target: string
  /** What the user has committed so far (never longer than target). */
  typed: string
  keystrokes: Keystroke[]
  /** Monotonic timestamp of the first keystroke; null until typing begins. */
  startedAt: number | null
  /** Timestamp of the last keystroke (== finish time once finished). */
  lastAt: number | null
  finished: boolean
}

export type EngineAction =
  | { type: 'input'; value: string; at: number }
  | { type: 'reset'; target: string }

export function initialState(target: string): EngineState {
  return { target, typed: '', keystrokes: [], startedAt: null, lastAt: null, finished: false }
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

export function reduce(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'reset':
      return initialState(action.target)

    case 'input': {
      if (state.finished) return state
      const targetChars = Array.from(state.target)
      // Never accept more characters than the target has.
      let valueChars = Array.from(action.value).slice(0, targetChars.length)
      // You can't type past a mistake: the wrong character is kept (so it is
      // logged as an error) but nothing after it, until it is backspaced.
      const mistake = valueChars.findIndex((ch, i) => ch !== targetChars[i])
      if (mistake !== -1) valueChars = valueChars.slice(0, mistake + 1)
      const value = valueChars.join('')
      if (value === state.typed) return state

      const startedAt = state.startedAt ?? action.at
      const t = Math.max(0, Math.round(action.at - startedAt))
      const prefix = commonPrefixLength(state.typed, value)
      const removed = Array.from(state.typed.slice(prefix)).length
      const added = Array.from(value.slice(prefix))

      const keystrokes = state.keystrokes.slice()
      for (let i = 0; i < removed; i++) keystrokes.push([t, '', BACKSPACE])
      let position = Array.from(state.typed.slice(0, prefix)).length
      for (const ch of added) {
        keystrokes.push([t, targetChars[position] ?? '', ch])
        position++
      }

      return {
        ...state,
        typed: value,
        keystrokes,
        startedAt,
        lastAt: action.at,
        finished: value === state.target,
      }
    }
  }
}

// ---- derived values ------------------------------------------------------------

export type CharStatus = 'correct' | 'incorrect' | 'current' | 'pending'

/** Per-character status of the target, for rendering. */
export function charStatuses(state: EngineState): CharStatus[] {
  const target = Array.from(state.target)
  const typed = Array.from(state.typed)
  return target.map((ch, i) => {
    if (i < typed.length) return typed[i] === ch ? 'correct' : 'incorrect'
    if (i === typed.length) return 'current'
    return 'pending'
  })
}

export interface LiveStats {
  elapsedMs: number
  wpm: number
  accuracy: number
  errors: number
}

/** Same formulas as the backend (typing_metrics.py), for the live display only.
 *  The server recomputes everything on submit; these numbers are never sent. */
export function liveStats(state: EngineState, now: number): LiveStats {
  if (state.startedAt === null) return { elapsedMs: 0, wpm: 0, accuracy: 100, errors: 0 }
  const end = state.finished && state.lastAt !== null ? state.lastAt : now
  const elapsedMs = Math.max(1, end - state.startedAt)
  let correct = 0
  let errors = 0
  for (const [, expected, typed] of state.keystrokes) {
    if (typed === BACKSPACE) continue
    if (typed === expected) correct++
    else errors++
  }
  const total = correct + errors
  return {
    elapsedMs,
    wpm: Math.round(((correct / 5) / (elapsedMs / 60_000)) * 10) / 10,
    accuracy: total === 0 ? 100 : Math.round((correct / total) * 1000) / 10,
    errors,
  }
}
