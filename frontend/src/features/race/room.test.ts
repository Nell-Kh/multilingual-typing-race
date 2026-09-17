import { describe, expect, it } from 'vitest'
import type { RoomPlayer } from '../../lib/api'
import type { ServerFrame } from './protocol'
import { initialRoom, reduceRoom, type RoomView } from './room'

const player = (id: string, extra: Partial<RoomPlayer> = {}): RoomPlayer => ({
  id,
  display_name: id,
  connected: true,
  typed: 0,
  errors: 0,
  finished_at: null,
  place: null,
  wpm: null,
  accuracy: null,
  valid: null,
  ...extra,
})

const SNAPSHOT: ServerFrame = {
  type: 'room',
  code: 'ABC123',
  state: 'lobby',
  host_id: 'a',
  language: 'he',
  difficulty: 2,
  text: null,
  starts_at: null,
  started_at: null,
  players: [player('a')],
}

function replay(frames: ServerFrame[], from: RoomView = initialRoom()): RoomView {
  return frames.reduce((v, frame) => reduceRoom(v, { type: 'frame', frame }), from)
}

describe('room reducer', () => {
  it('starts from the snapshot', () => {
    const v = replay([SNAPSHOT])

    expect(v.code).toBe('ABC123')
    expect(v.hostId).toBe('a')
    expect(v.language).toBe('he')
    expect(v.players.map((p) => p.id)).toEqual(['a'])
  })

  it('adds joiners once, even when our own join is echoed back', () => {
    const v = replay([
      SNAPSHOT,
      { type: 'player_joined', player: player('a') }, // echo of ourselves
      { type: 'player_joined', player: player('b') },
      { type: 'player_joined', player: player('b') },
    ])

    expect(v.players.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('tracks leaving, connection and host changes', () => {
    const v = replay([
      SNAPSHOT,
      { type: 'player_joined', player: player('b') },
      { type: 'player_connection', player_id: 'b', connected: false },
      { type: 'player_left', player_id: 'a' },
      { type: 'host_changed', host_id: 'b' },
    ])

    expect(v.players).toEqual([player('b', { connected: false })])
    expect(v.hostId).toBe('b')
  })

  it('countdown resets everyone and carries the text; started unlocks', () => {
    const text = { id: 't1', content: 'שלום עולם', char_count: 9 }
    const v = replay([
      SNAPSHOT,
      { type: 'player_joined', player: player('b', { typed: 5, place: 1, wpm: 40 }) },
      { type: 'countdown', text, starts_at: '2026-09-17T10:00:03Z' },
    ])
    expect(v.state).toBe('countdown')
    expect(v.text).toEqual(text)
    expect(v.players.every((p) => p.typed === 0 && p.place === null && p.wpm === null)).toBe(true)

    const running = replay([{ type: 'started', started_at: '2026-09-17T10:00:03Z' }], v)
    expect(running.state).toBe('running')
    expect(running.startedAt).toBe('2026-09-17T10:00:03Z')
  })

  it('progress and finishes update the right player', () => {
    const text = { id: 't1', content: 'abc', char_count: 3 }
    const v = replay([
      SNAPSHOT,
      { type: 'player_joined', player: player('b') },
      { type: 'countdown', text, starts_at: 'x' },
      { type: 'started', started_at: 'x' },
      { type: 'progress', player_id: 'b', typed: 2, errors: 1 },
      { type: 'player_finished', player_id: 'a', place: 1, wpm: 55, accuracy: 98, valid: true },
    ])

    const [a, b] = v.players
    expect(b.typed).toBe(2)
    expect(b.errors).toBe(1)
    expect(a.place).toBe(1)
    expect(a.wpm).toBe(55)
    expect(a.typed).toBe(3) // finished players show a full bar
  })

  it('race_over carries the results; errors are kept until the next good frame', () => {
    const results = [
      { player_id: 'a', display_name: 'a', place: 1, wpm: 55, accuracy: 98, valid: true, dnf: false },
      { player_id: 'b', display_name: 'b', place: null, wpm: null, accuracy: null, valid: null, dnf: true },
    ]
    const v = replay([
      SNAPSHOT,
      { type: 'error', code: 'not_host', message: 'Only the host can start the race' },
    ])
    expect(v.error?.code).toBe('not_host')

    const over = replay([{ type: 'race_over', results }], v)
    expect(over.state).toBe('finished')
    expect(over.results).toEqual(results)
  })

  it('ignores unknown frame types', () => {
    const v = replay([SNAPSHOT, { type: 'something_new' } as unknown as ServerFrame])

    expect(v.code).toBe('ABC123')
  })
})
