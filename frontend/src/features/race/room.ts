// Room state on the client: a pure reducer over server frames (docs/race-protocol.md
// §4). Like the typing engine, it has no DOM and no timers, so it is unit-tested by
// replaying frames. The component only renders what is here.

import type { Language, RoomPlayer } from '../../lib/api'
import type { RaceResultRow, RaceText, RoomState, ServerFrame } from './protocol'

export interface RoomView {
  connected: boolean
  code: string | null
  state: RoomState
  hostId: string | null
  language: Language
  difficulty: 1 | 2 | 3
  text: RaceText | null
  startsAt: string | null
  startedAt: string | null
  players: RoomPlayer[]
  results: RaceResultRow[] | null
  /** Last error frame from the server, cleared by the next successful frame. */
  error: { code: string; message: string } | null
}

export type RoomAction =
  | { type: 'frame'; frame: ServerFrame }
  | { type: 'socket'; connected: boolean }

export function initialRoom(): RoomView {
  return {
    connected: false,
    code: null,
    state: 'lobby',
    hostId: null,
    language: 'en',
    difficulty: 1,
    text: null,
    startsAt: null,
    startedAt: null,
    players: [],
    results: null,
    error: null,
  }
}

function patchPlayer(
  players: RoomPlayer[],
  id: string,
  patch: Partial<RoomPlayer>,
): RoomPlayer[] {
  return players.map((p) => (p.id === id ? { ...p, ...patch } : p))
}

export function reduceRoom(view: RoomView, action: RoomAction): RoomView {
  if (action.type === 'socket') return { ...view, connected: action.connected }
  const f = action.frame
  switch (f.type) {
    case 'room':
      return {
        ...view,
        code: f.code,
        state: f.state,
        hostId: f.host_id,
        language: f.language,
        difficulty: f.difficulty,
        text: f.text,
        startsAt: f.starts_at,
        startedAt: f.started_at,
        players: f.players,
        results: f.state === 'finished' ? view.results : null,
        error: null,
      }
    case 'player_joined':
      // Our own join is echoed back too; keep the list free of duplicates.
      return view.players.some((p) => p.id === f.player.id)
        ? { ...view, players: patchPlayer(view.players, f.player.id, f.player) }
        : { ...view, players: [...view.players, f.player] }
    case 'player_left':
      return { ...view, players: view.players.filter((p) => p.id !== f.player_id) }
    case 'player_connection':
      return { ...view, players: patchPlayer(view.players, f.player_id, { connected: f.connected }) }
    case 'host_changed':
      return { ...view, hostId: f.host_id }
    case 'countdown':
      return {
        ...view,
        state: 'countdown',
        text: f.text,
        startsAt: f.starts_at,
        startedAt: null,
        results: null,
        error: null,
        players: view.players.map((p) => ({
          ...p,
          typed: 0,
          errors: 0,
          finished_at: null,
          place: null,
          wpm: null,
          accuracy: null,
          valid: null,
        })),
      }
    case 'started':
      return { ...view, state: 'running', startedAt: f.started_at }
    case 'progress':
      return {
        ...view,
        players: patchPlayer(view.players, f.player_id, { typed: f.typed, errors: f.errors }),
      }
    case 'player_finished':
      return {
        ...view,
        players: patchPlayer(view.players, f.player_id, {
          finished_at: new Date().toISOString(),
          place: f.place,
          wpm: f.wpm,
          accuracy: f.accuracy,
          valid: f.valid,
          typed: view.text?.char_count ?? 0,
        }),
      }
    case 'race_over':
      return { ...view, state: 'finished', results: f.results }
    case 'error':
      return { ...view, error: { code: f.code, message: f.message } }
    default:
      return view // unknown frame types are ignored on purpose (§3)
  }
}
