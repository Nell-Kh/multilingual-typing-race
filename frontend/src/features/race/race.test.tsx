import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAccessToken } from '../../lib/api'
import { useAuth } from '../auth/store'
import type { ClientFrame, ServerFrame } from './protocol'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ME = { id: 'me', email: 'n@x.com', display_name: 'Nell', role: 'user', preferred_language: 'en', created_at: '' }
const OTHER = { id: 'o1', display_name: 'Sami', connected: true, typed: 0, errors: 0, finished_at: null, place: null, wpm: null, accuracy: null, valid: null }
const SELF = { ...OTHER, id: 'me', display_name: 'Nell' }
const TEXT = { id: 't1', content: 'cat sat', char_count: 7 }

/** A WebSocket the test controls: records what the page sends, lets us push frames. */
class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: ClientFrame[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientFrame)
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: '' })
  }
  // test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  push(frame: ServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

beforeEach(() => {
  cleanup()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: ME as never })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (url.includes('/auth/me')) return json(ME)
      if (url.endsWith('/rooms') && init?.method === 'POST')
        return json({ code: 'NEW123', state: 'lobby', host_id: 'me', language: 'en', difficulty: 1, max_players: 5, players: [] }, 201)
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openRoom(
  code = 'ABC123',
  hostId = 'me',
  { language = 'en', players = [SELF, OTHER] }: { language?: 'en' | 'he' | 'ar'; players?: (typeof SELF)[] } = {},
) {
  window.history.pushState({}, '', `/race/${code}`)
  render(<App />)
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
  const ws = lastSocket()
  ws.open()
  expect(ws.url).toContain(`/api/v1/rooms/${code}/ws`)
  expect(ws.sent[0]).toEqual({ type: 'auth', token: 'tok' })
  ws.push({
    type: 'room', code, state: 'lobby', host_id: hostId, language, difficulty: 1,
    max_players: 4, text: null, starts_at: null, started_at: null, players,
  })
  return ws
}

describe('race entry page', () => {
  it('creates a room and navigates to it', async () => {
    window.history.pushState({}, '', '/race')
    render(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Create room' }))

    await waitFor(() => expect(window.location.pathname).toBe('/race/NEW123'))
  })

  it('joins by code, upper-cased', async () => {
    window.history.pushState({}, '', '/race')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Room code'), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(window.location.pathname).toBe('/race/ABC123'))
  })
})

describe('room page', () => {
  it('shows the lobby and lets the host start', async () => {
    const ws = await openRoom()
    const user = userEvent.setup()

    expect(await screen.findByText('Sami')).toBeInTheDocument()
    expect(within(screen.getByTestId('player-me')).getByText('host')).toBeInTheDocument()
    // The cap comes from the server's snapshot (4 here), not a number in the page.
    expect(screen.getByTestId('seats')).toHaveTextContent('2/4 players')
    await user.click(screen.getByRole('button', { name: 'Start race' }))

    expect(ws.sent.at(-1)).toEqual({ type: 'start' })
  })

  it('guests wait for the host', async () => {
    await openRoom('ABC123', 'o1')

    expect(await screen.findByText('Waiting for the host to start…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start race' })).not.toBeInTheDocument()
  })

  it('countdown shows the text locked, started unlocks it, finishing sends the log', async () => {
    const ws = await openRoom()
    const user = userEvent.setup()

    ws.push({ type: 'countdown', text: TEXT, starts_at: new Date(Date.now() + 3000).toISOString() })
    const input = await screen.findByRole('textbox', { name: 'Type the text above' })
    expect(input).toBeDisabled()
    expect(screen.getByTestId('countdown')).toHaveTextContent('3')

    const startedAt = new Date().toISOString()
    ws.push({ type: 'started', started_at: startedAt })
    await waitFor(() => expect(input).toBeEnabled())

    await user.type(input, 'cat sat')

    const finish = ws.sent.find((f) => f.type === 'finish')
    expect(finish).toBeDefined()
    if (finish?.type !== 'finish') throw new Error('unreachable')
    expect(finish.started_at).toBe(startedAt)
    expect(finish.keystrokes).toHaveLength(7)
    expect(finish.keystrokes[0][1]).toBe('c')
    // Timestamps are measured from the server's "go", so the first key is not at 0.
    expect(finish.keystrokes[0][0]).toBeGreaterThanOrEqual(0)
    expect(ws.sent.filter((f) => f.type === 'finish')).toHaveLength(1)
    expect(ws.sent.some((f) => f.type === 'progress')).toBe(true)
  })

  it('renders other players progress and the final results', async () => {
    const ws = await openRoom()

    ws.push({ type: 'countdown', text: TEXT, starts_at: new Date().toISOString() })
    ws.push({ type: 'started', started_at: new Date().toISOString() })
    ws.push({ type: 'progress', player_id: 'o1', typed: 3, errors: 0 })
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Sami progress' })).toHaveAttribute('aria-valuenow', '43'),
    )

    ws.push({
      type: 'player_finished',
      player_id: 'o1',
      place: 1,
      wpm: 61.5,
      accuracy: 100,
      valid: true,
      duration_ms: 6800,
      reason: null,
    })
    await waitFor(() => expect(screen.getByTestId('player-o1')).toHaveTextContent('#1 · 61.5 wpm'))

    ws.push({
      type: 'race_over',
      results: [
        { player_id: 'o1', display_name: 'Sami', place: 1, wpm: 61.5, accuracy: 100, valid: true, duration_ms: 6800, reason: null, dnf: false },
        { player_id: 'me', display_name: 'Nell', place: null, wpm: null, accuracy: null, valid: null, duration_ms: null, reason: null, dnf: true },
      ],
    })

    const results = await screen.findByRole('region', { name: 'results' })
    expect(results).toHaveTextContent('#1')
    expect(screen.getByTestId('result-me')).toHaveTextContent('dnf')
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument()
  })

  it('shows server errors and a rejected room', async () => {
    const ws = await openRoom('ABC123', 'o1')

    ws.push({ type: 'error', code: 'not_host', message: 'Only the host can start the race' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the host can start the race')

    ws.onclose?.({ code: 4409, reason: 'room_full' })
    expect(await screen.findByTestId('problem-room_full')).toHaveTextContent('This room is full')
  })

  it('lists the lobby as rows: initial, name, host, you, connection, seats', async () => {
    const ws = await openRoom('ABC123', 'o1')
    ws.push({ type: 'player_connection', player_id: 'o1', connected: false })

    const sami = await screen.findByTestId('player-o1')
    expect(sami).toHaveTextContent('S')
    expect(sami).toHaveTextContent('Sami')
    expect(within(sami).getByText('host')).toBeInTheDocument()
    await waitFor(() => expect(sami).toHaveTextContent('reconnecting…'))
    const me = screen.getByTestId('player-me')
    expect(me).toHaveTextContent('(you)')
    expect(me).toHaveTextContent('connected')
    expect(screen.getByTestId('seats')).toHaveTextContent('2/4 players')
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABC123')
  })

  it('will not start a race alone, and says why', async () => {
    await openRoom('ABC123', 'me', { players: [SELF] })

    expect(await screen.findByRole('button', { name: 'Start race' })).toBeDisabled()
    expect(screen.getByTestId('start-reason')).toHaveTextContent('A race needs at least 2 players')
  })

  it('shows the text during the countdown but will not take the keyboard', async () => {
    const ws = await openRoom()
    const user = userEvent.setup()
    ws.push({ type: 'countdown', text: TEXT, starts_at: new Date(Date.now() + 3000).toISOString() })

    const input = await screen.findByRole('textbox', { name: 'Type the text above' })
    await waitFor(() => expect(screen.getByTestId('typing-box')).toHaveTextContent('cat sat'))
    await user.click(screen.getByTestId('typing-box'))
    expect(input).not.toHaveFocus()
    expect(input).toBeDisabled()
    expect(screen.getByTestId('countdown')).toHaveTextContent('3')
  })

  it.each([
    ['en', 'ltr'],
    ['ar', 'rtl'],
    ['he', 'rtl'],
  ] as const)('fills progress bars from the start edge of %s (%s)', async (language, dir) => {
    const ws = await openRoom('ABC123', 'me', { language })
    ws.push({ type: 'countdown', text: TEXT, starts_at: new Date().toISOString() })
    ws.push({ type: 'started', started_at: new Date().toISOString() })

    expect(await screen.findByTestId('bar-o1')).toHaveAttribute('dir', dir)
    expect(screen.getByTestId('bar-me')).toHaveAttribute('dir', dir)
  })

  it("shows every player's exact time and why another player's run was not counted", async () => {
    const startedAt = new Date(Date.now() - 5000).toISOString()
    const ws = await openRoom()
    ws.push({ type: 'countdown', text: TEXT, starts_at: startedAt })
    ws.push({ type: 'started', started_at: startedAt })
    ws.push({
      type: 'player_finished',
      player_id: 'o1',
      place: null,
      wpm: 300,
      accuracy: 100,
      valid: false,
      duration_ms: 1234,
      reason: 'median_gap_too_low',
    })
    ws.push({
      type: 'race_over',
      results: [
        { player_id: 'me', display_name: 'Nell', place: 1, wpm: 48.2, accuracy: 98, valid: true, duration_ms: 8650, reason: null, dnf: false },
        { player_id: 'o1', display_name: 'Sami', place: null, wpm: 300, accuracy: 100, valid: false, duration_ms: 1234, reason: 'median_gap_too_low', dnf: false },
      ],
    })

    // Another player's refusal, with the reason and their time, both from the server (ADR-033).
    const theirs = await screen.findByTestId('result-o1')
    expect(theirs).toHaveTextContent('not counted')
    expect(within(theirs).getByTestId('result-reason-o1')).toHaveTextContent('faster than a person can sustain')
    expect(theirs).toHaveTextContent('1.2s')
    const mine = screen.getByTestId('result-me')
    expect(mine).toHaveTextContent('counted')
    expect(mine).not.toHaveTextContent('not counted')
    expect(mine).toHaveTextContent('8.7s')
    expect(within(mine).queryByTestId('result-reason-me')).not.toBeInTheDocument()
    // No estimates, and no second request to piece my own run together.
    expect(screen.getByRole('region', { name: 'results' })).not.toHaveTextContent('≈')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/me/sessions'))).toBe(false)
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })

  it.each([
    ['room_full', 'This room is full', 'Open a room'],
    ['no_room', 'No room with this code', 'Open a room'],
    ['wrong_state', 'This race has already started', 'Open a room'],
    ['invalid token', 'Your session has ended', 'Log in'],
  ])('a refusal (%s) gets its own card and a way out', async (reason, title, way) => {
    const ws = await openRoom()
    ws.onclose?.({ code: reason === 'invalid token' ? 4401 : 4409, reason })

    const card = await screen.findByRole('alert')
    expect(card).toHaveTextContent(title)
    expect(within(card).getByRole('link', { name: way })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })

  it('a connection that does not come back gets a card with Try again', async () => {
    const ws = await openRoom()
    await screen.findByTestId('player-me')
    vi.useFakeTimers()
    try {
      act(() => ws.onclose?.({ code: 1006, reason: '' }))
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(16_000))
      expect(screen.getByTestId('problem-lost')).toHaveTextContent('Connection lost')
      expect(within(screen.getByTestId('problem-lost')).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('being swept from the lobby gets a card with Rejoin', async () => {
    const ws = await openRoom()
    await screen.findByTestId('player-me')

    ws.push({ type: 'player_left', player_id: 'me' })

    expect(await screen.findByTestId('problem-removed')).toHaveTextContent('You are no longer in this room')
    expect(screen.getByRole('button', { name: 'Rejoin' })).toBeInTheDocument()
  })
})
