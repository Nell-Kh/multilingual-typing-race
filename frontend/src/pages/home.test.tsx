import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setAccessToken } from '../lib/api'
import { useAuth } from '../features/auth/store'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER = { id: 'u1', email: 'n@x.com', display_name: 'Nell', role: 'user', preferred_language: 'en', created_at: '' }
const TEXT = { id: 'd1', language: 'en', content: 'snow on the gate', char_count: 16, difficulty: 1, source: 'seed', license: 'CC0-1.0', is_active: true, created_at: '' }
const DAILY = { day: '2026-09-28', language: 'en', text: TEXT }
const PROBLEM = { error: { code: 'unavailable', message: 'try later' } }

/** Answer auth normally and hand every /daily request to `daily`. */
function serve(daily: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
      if (u.includes('/auth/me')) return Promise.resolve(json(USER))
      if (u.includes('/daily?lang=')) return Promise.resolve(daily())
      return Promise.resolve(json({}, 404))
    }),
  )
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: USER as never })
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('home page daily card', () => {
  it('says it is loading while the challenge is on its way', async () => {
    let release: (r: Response) => void = () => {}
    serve(() => new Promise<Response>((resolve) => (release = resolve)))
    render(<App />)

    expect(await screen.findByTestId('daily-loading')).toHaveTextContent("Loading today's challenge")
    release(json(DAILY))
    expect(await screen.findByTestId('daily-card')).toHaveTextContent('snow on the gate')
    expect(screen.queryByTestId('daily-loading')).not.toBeInTheDocument()
  })

  it('says so when the challenge fails to load, and can try again', async () => {
    let fail = true
    serve(() => (fail ? json(PROBLEM, 503) : json(DAILY)))
    render(<App />)

    const alert = await screen.findByTestId('daily-error')
    expect(alert).toHaveTextContent("Could not load today's challenge.")
    expect(screen.queryByTestId('daily-card')).not.toBeInTheDocument()

    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('daily-card')).toHaveTextContent('snow on the gate')
    expect(screen.queryByTestId('daily-error')).not.toBeInTheDocument()
  })

  it('tells "no text in this language" apart from "did not load"', async () => {
    serve(() => json(PROBLEM, 404))
    render(<App />)

    expect(await screen.findByTestId('daily-error')).toHaveTextContent('No daily challenge in this language yet.')
  })
})

describe('home page entries', () => {
  function serveHome(extra: (u: string) => Response | undefined) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const u = String(url)
        const hit = extra(u)
        if (hit) return Promise.resolve(hit)
        if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
        if (u.includes('/auth/me')) return Promise.resolve(json(USER))
        if (u.includes('/daily?lang=')) return Promise.resolve(json(DAILY))
        return Promise.resolve(json(PROBLEM, 404))
      }),
    )
  }

  it('offers Practice, Race and Daily, and tells a new player where to start', async () => {
    serveHome((u) => (u.includes('/me/stats') ? json({ languages: [], trend: [] }) : undefined))
    render(<App />)

    for (const name of ['Practice', 'Race', 'Daily']) {
      expect(await screen.findByRole('region', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Start practice' })).toHaveAttribute('href', '/practice')
    expect(screen.getByRole('button', { name: 'Create a room' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled() // until a 6-letter code
    expect(await screen.findByTestId('daily-card')).toHaveTextContent('snow on the gate')
    expect(screen.getByTestId('tagline')).toHaveTextContent('Type in English · עברית · العربية')
    await waitFor(() =>
      expect(screen.getByTestId('best-row')).toHaveTextContent('No runs yet — start with Practice.'),
    )
  })

  it('shows your best per language, and a daily already done today', async () => {
    serveHome((u) => {
      if (u.includes('/me/stats'))
        return json({
          languages: [{ language: 'he', runs: 3, best_wpm: 61.2, avg_wpm: 55, avg_accuracy: 97, total_time_ms: 90000 }],
          trend: [],
        })
      if (u.includes('/daily/leaderboard'))
        return json({ language: 'en', period: 'day', rows: [], me: { rank: 2, user_id: 'u1', display_name: 'Nell', wpm: 58, accuracy: 99, started_at: '' } })
      return undefined
    })
    render(<App />)

    expect(await screen.findByTestId('best-row')).toHaveTextContent('עברית 61.2 wpm')
    expect(screen.getByRole('link', { name: 'All your stats' })).toHaveAttribute('href', '/stats')
    expect(await screen.findByTestId('daily-done')).toHaveTextContent('Done today #2 with 58 wpm')
    expect(screen.getByRole('link', { name: 'Try it again' })).toHaveAttribute('href', '/practice?daily=1&lang=en')
  })

  it('the language picker changes the daily text and is remembered for practice', async () => {
    serveHome((u) =>
      u.includes('/daily?lang=he')
        ? json({ ...DAILY, language: 'he', text: { ...TEXT, language: 'he', content: 'שלג על השער' } })
        : undefined,
    )
    render(<App />)
    const user = userEvent.setup()
    await screen.findByTestId('daily-card')

    await user.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'עברית' }))

    expect(await screen.findByTestId('daily-preview')).toHaveTextContent('שלג על השער')
    expect(screen.getByTestId('daily-preview')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('link', { name: "Type today's text" })).toHaveAttribute('href', '/practice?daily=1&lang=he')
  })
})
