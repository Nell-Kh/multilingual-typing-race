import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAccessToken } from '../../lib/api'
import { useAuth } from '../auth/store'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER = { id: 'u1', email: 'n@x.com', display_name: 'Nell', role: 'user', preferred_language: 'en', created_at: '' }
const TEXT = { id: 't1', language: 'en', content: 'cat sat', char_count: 7, difficulty: 1, source: 'seed', license: 'CC0-1.0', is_active: true, created_at: '' }
const GUEST_RESULT = {
  saved: false, text_id: 't1', language: 'en', duration_ms: 1200, wpm: 70, cpm: 350, raw_wpm: 70,
  accuracy: 100, error_count: 0, keystroke_count: 7, is_valid: true, invalid_reason: null, key_stats: [],
}

let calls: { url: string; init?: RequestInit }[]
let signedIn: boolean

beforeEach(() => {
  cleanup()
  localStorage.clear()
  calls = []
  signedIn = false
  setAccessToken(null)
  useAuth.setState({ status: 'unknown', user: null })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/auth/refresh'))
        return signedIn ? json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }) : json({ error: {} }, 401)
      if (url.includes('/auth/me')) return json(USER)
      if (url.includes('/texts/random')) return json(TEXT)
      if (url.endsWith('/sessions/guest') && init?.method === 'POST') return json(GUEST_RESULT)
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('guest practice', () => {
  it('the landing page offers "Try it now", which opens practice in guest mode', async () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    const user = userEvent.setup()

    const tryIt = await screen.findByRole('link', { name: 'Try it now' })
    expect(tryIt).toHaveAttribute('href', '/try')
    await user.click(tryIt)

    expect(await screen.findByTestId('guest-banner')).toHaveTextContent(
      'Guest run — not saved. Create an account to keep your stats.',
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
    expect(await screen.findByRole('textbox', { name: 'Type the text above' })).toBeInTheDocument()
    // No app navigation for a guest: stats, races and the daily belong to accounts.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('scores a guest run on the guest endpoint, without a token, and says it was not saved', async () => {
    window.history.pushState({}, '', '/try')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: 'Type the text above' }), 'cat sat')

    expect(await screen.findByTestId('result-wpm')).toHaveTextContent('70')
    expect(screen.getByTestId('result-status')).toHaveTextContent('Valid · not saved')
    expect(screen.getByTestId('guest-result-note')).toHaveTextContent('not saved')

    const posts = calls.filter((c) => c.init?.method === 'POST' && !c.url.includes('/auth/'))
    expect(posts.map((c) => new URL(c.url, 'http://x').pathname)).toEqual(['/api/v1/sessions/guest'])
    const headers = new Headers(posts[0].init?.headers)
    expect(headers.get('Authorization')).toBeNull()
    const body = JSON.parse(String(posts[0].init?.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['keystrokes', 'started_at', 'text_id'])
  })

  it.each(['/stats', '/race', '/leaderboard', '/practice?daily=1&lang=en'])(
    'a guest cannot reach %s: it asks them to log in',
    async (path) => {
      window.history.pushState({}, '', path)
      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    },
  )

  it('asking the guest page for the daily still gives free practice, not the daily board', async () => {
    window.history.pushState({}, '', '/try?daily=1&lang=he')
    render(<App />)

    expect(await screen.findByTestId('guest-banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeInTheDocument()
    await screen.findByRole('textbox', { name: 'Type the text above' })
    expect(calls.some((c) => c.url.includes('/daily'))).toBe(false)
  })

  it('a signed-in player who opens /try is sent to the practice page that keeps their runs', async () => {
    signedIn = true
    window.history.pushState({}, '', '/try')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/practice'))
    expect(screen.queryByTestId('guest-banner')).not.toBeInTheDocument()
  })
})
