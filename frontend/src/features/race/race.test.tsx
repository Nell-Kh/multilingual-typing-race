import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
        return json({ code: 'NEW123', state: 'lobby', host_id: 'me', language: 'en', difficulty: 1, players: [] }, 201)
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openRoom(code = 'ABC123', hostId = 'me') {
  window.history.pushState({}, '', `/race/${code}`)
  render(<App />)
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
  const ws = lastSocket()
  ws.open()
  expect(ws.url).toContain(`/api/v1/rooms/${code}/ws`)
  expect(ws.sent[0]).toEqual({ type: 'auth', token: 'tok' })
  ws.push({
    type: 'room', code, state: 'lobby', host_id: hostId, language: 'en', difficulty: 1,
    text: null, starts_at: null, started_at: null, players: [SELF, OTHER],
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
    expect(screen.getByText('(host)')).toBeInTheDocument()
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

    ws.push({ type: 'player_finished', player_id: 'o1', place: 1, wpm: 61.5, accuracy: 100, valid: true })
    await waitFor(() => expect(screen.getByTestId('player-o1')).toHaveTextContent('#1 · 61.5 wpm'))

    ws.push({
      type: 'race_over',
      results: [
        { player_id: 'o1', display_name: 'Sami', place: 1, wpm: 61.5, accuracy: 100, valid: true, dnf: false },
        { player_id: 'me', display_name: 'Nell', place: null, wpm: null, accuracy: null, valid: null, dnf: true },
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
    expect(await screen.findByText(/Could not join room ABC123: room_full/)).toBeInTheDocument()
  })
})
