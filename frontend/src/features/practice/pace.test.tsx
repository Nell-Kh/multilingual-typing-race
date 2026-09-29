import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAccessToken } from '../../lib/api'
import { initialState, reduce, type EngineState } from '../typing-engine/engine'
import { useAuth } from '../auth/store'
import { correctPrefix, ghostChars, pacerChars } from './pace'

describe('the pacer', () => {
  it('fills at the chosen WPM: five characters a word, steadily', () => {
    expect(pacerChars(60, 60_000, 1000)).toBe(300) // 60 words a minute = 300 characters
    expect(pacerChars(40, 30_000, 1000)).toBe(100)
    expect(pacerChars(80, 15_000, 1000)).toBe(100)
    // Steady: twice the time, twice the characters, at any of the three speeds.
    for (const wpm of [40, 60, 80]) expect(pacerChars(wpm, 24_000, 1000)).toBe(2 * pacerChars(wpm, 12_000, 1000))
  })

  it('waits for your first key and stops at the end of the text', () => {
    expect(pacerChars(60, 0, 50)).toBe(0)
    expect(pacerChars(60, -5, 50)).toBe(0)
    expect(pacerChars(80, 600_000, 50)).toBe(50)
  })
})

describe('the ghost', () => {
  /**
   * The server's per-character times for a run of "cats" with one wrong key at the
   * third letter, corrected (the same log the backend ghost test replays):
   * c@0, a@140, t typed wrong @280, backspace @430, t@560, s@700.
   */
  const LOG: [number, string][] = [
    [0, 'c'],
    [140, 'ca'],
    [280, 'ca#'],
    [430, 'ca'],
    [560, 'cat'],
    [700, 'cats'],
  ]
  const OFFSETS = [0, 140, 560, 700]

  it('matches the replayed log: at every key, the ghost has as much text as the run did', () => {
    let engine: EngineState = initialState('cats')
    for (const [t, value] of LOG) {
      engine = reduce(engine, { type: 'input', value, at: 1000 + t })
      // The real typing engine, fed the same run, and the ghost agree key by key —
      // including while the wrong letter is on screen.
      expect(ghostChars(OFFSETS, t)).toBe(correctPrefix(engine.typed, engine.target))
    }
    expect(engine.finished).toBe(true)
  })

  it('counts the characters whose time has passed, between keys too', () => {
    expect(ghostChars(OFFSETS, -1)).toBe(0)
    expect(ghostChars(OFFSETS, 139)).toBe(1)
    expect(ghostChars(OFFSETS, 559)).toBe(2) // the corrected letter is not there until 560
    expect(ghostChars(OFFSETS, 10_000)).toBe(4)
    expect(ghostChars([], 500)).toBe(0)
  })
})

// ---- on the page ------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const USER = { id: 'u1', email: 'n@x.com', display_name: 'Nell', role: 'user', preferred_language: 'en', created_at: '' }
const TEXT = { id: 't1', language: 'en', content: 'cat sat', char_count: 7, difficulty: 1, source: 'seed', license: 'CC0-1.0', is_active: true, created_at: '' }
const GHOST = { day: '2026-09-29', language: 'en', text_id: 't1', display_name: 'Sami', wpm: 88.2, offsets_ms: [0, 100, 200, 300, 400, 500, 600] }

let ghostResponse: () => Response

beforeEach(() => {
  cleanup()
  localStorage.clear()
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: USER as never })
  ghostResponse = () => json(GHOST)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (url.includes('/auth/me')) return json(USER)
      if (url.includes('/texts/random')) return json(TEXT)
      if (url.includes('/daily/ghost')) return ghostResponse()
      if (url.includes('/daily/leaderboard')) return json({ language: 'en', period: 'day', rows: [], me: null })
      if (url.includes('/daily?lang=')) return json({ day: '2026-09-29', language: 'en', text: TEXT })
      if (url.endsWith('/sessions') && init?.method === 'POST') return json({}, 500)
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('pacer and ghost on the practice page', () => {
  it('free practice offers a pacer at 40, 60 or 80 WPM, drawn as a second race row', async () => {
    window.history.pushState({}, '', '/practice')
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'Type the text above' })

    const group = screen.getByRole('group', { name: 'Pacer' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Off', '40', '60', '80'])
    expect(screen.queryByRole('list', { name: 'pace' })).not.toBeInTheDocument()

    await user.click(within(group).getByRole('button', { name: '60' }))
    expect(screen.getByTestId('pace-pacer')).toHaveTextContent('Pacer 60 wpm')
    expect(screen.getByTestId('pace-you')).toHaveTextContent('Nell you')
    // It waits for your first key.
    expect(screen.getByRole('progressbar', { name: 'Pacer progress' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByTestId('pace-bar-pacer')).toHaveAttribute('dir', 'ltr')
  })

  it('the daily offers "Race today\'s #1" and draws their run as a ghost row', async () => {
    window.history.pushState({}, '', '/practice?daily=1&lang=en')
    render(<App />)
    const user = userEvent.setup()

    const race = await screen.findByRole('button', { name: "Race today's #1" })
    expect(screen.getByTestId("ghost-offer")).toHaveTextContent("Sami, 88.2 wpm")
    expect(screen.queryByRole('group', { name: 'Pacer' })).not.toBeInTheDocument()
    await user.click(race)

    expect(screen.getByTestId('pace-ghost')).toHaveTextContent('Sami #1 today · 88.2 wpm')
    await user.type(screen.getByRole('textbox', { name: 'Type the text above' }), 'c')
    // Your own bar follows what you have typed correctly.
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Nell progress' })).toHaveAttribute('aria-valuenow', '14'),
    )
    expect(screen.getByRole('button', { name: 'Stop racing the #1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('before anyone has a counted daily run, it says so instead of offering a ghost', async () => {
    ghostResponse = () => json({ error: { code: 'no_ghost', message: 'Nobody yet' } }, 404)
    window.history.pushState({}, '', '/practice?daily=1&lang=en')
    render(<App />)

    expect(await screen.findByTestId('no-ghost')).toHaveTextContent("Nobody has a counted run on today's text yet.")
    expect(screen.queryByRole('button', { name: "Race today's #1" })).not.toBeInTheDocument()
  })
})
