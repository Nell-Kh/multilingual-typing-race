// Frames of docs/race-protocol.md §4, typed. Server → client frames are what the
// reducer in room.ts consumes; client → server frames are what socket.ts sends.

import type { KeystrokeLog, Language, RoomPlayer } from '../../lib/api'

export type RoomState = 'lobby' | 'countdown' | 'running' | 'finished'

export interface RaceText {
  id: string
  content: string
  char_count: number
}

export interface RaceResultRow {
  player_id: string
  display_name: string
  place: number | null
  wpm: number | null
  accuracy: number | null
  valid: boolean | null
  dnf: boolean
}

export type ServerFrame =
  | {
      type: 'room'
      code: string
      state: RoomState
      host_id: string
      language: Language
      difficulty: 1 | 2 | 3
      text: RaceText | null
      starts_at: string | null
      started_at: string | null
      players: RoomPlayer[]
    }
  | { type: 'player_joined'; player: RoomPlayer }
  | { type: 'player_left'; player_id: string }
  | { type: 'player_connection'; player_id: string; connected: boolean }
  | { type: 'host_changed'; host_id: string }
  | { type: 'countdown'; text: RaceText; starts_at: string }
  | { type: 'started'; started_at: string }
  | { type: 'progress'; player_id: string; typed: number; errors: number }
  | {
      type: 'player_finished'
      player_id: string
      place: number | null
      wpm: number
      accuracy: number
      valid: boolean
    }
  | { type: 'race_over'; results: RaceResultRow[] }
  | { type: 'error'; code: string; message: string }

export type ClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'start' }
  | { type: 'progress'; typed: number; errors: number }
  | { type: 'finish'; started_at: string; keystrokes: KeystrokeLog }
  | { type: 'play_again' }
  | { type: 'leave' }
