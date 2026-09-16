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
const RESULT = {
  id: 's1', text_id: 't1', mode: 'practice', language: 'en', started_at: '', finished_at: '',
  duration_ms: 1200, wpm: 70, cpm: 350, raw_wpm: 80, accuracy: 87.5, error_count: 1, keystroke_count: 9,
  is_valid: true, invalid_reason: null, created_at: '',
  key_stats: [{ key: 'a', correct: 2, errors: 1, avg_latency_ms: 150 }],
}

let submitted: { body: unknown } | null

beforeEach(() => {
  cleanup()
  localStorage.clear()
  submitted = null
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: USER as never })
  window.history.pushState({}, '', '/practice')
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (url.includes('/auth/me')) return json(USER)
      if (url.includes('/texts/random')) return json(TEXT)
      if (url.endsWith('/sessions') && init?.method === 'POST') {
        submitted = { body: JSON.parse(String(init.body)) }
        return json(RESULT, 201)
      }
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('practice page', () => {
  it('loads a text and shows it with the live stats', async () => {
    render(<App />)

    expect(await screen.findByRole('textbox', { name: 'Type the text above' })).toBeInTheDocument()
    expect(screen.getByTestId('live-wpm')).toHaveTextContent('0')
    expect(screen.getByTestId('live-accuracy')).toHaveTextContent('100%')
  })

  it('typing the whole text submits the keystroke log and shows the server result', async () => {
    render(<App />)
    const user = userEvent.setup()
    const input = await screen.findByRole('textbox', { name: 'Type the text above' })

    await user.type(input, 'cat sat')

    expect(await screen.findByTestId('result-wpm')).toHaveTextContent('70')
    expect(screen.getByTestId('result-accuracy')).toHaveTextContent('87.5%')
    expect(screen.getByText('Most missed:')).toBeInTheDocument()

    // What went to the server: only text id, start time, and the log.
    expect(submitted).not.toBeNull()
    const body = submitted!.body as { text_id: string; started_at: string; keystrokes: unknown[][] }
    expect(Object.keys(body).sort()).toEqual(['keystrokes', 'started_at', 'text_id'])
    expect(body.text_id).toBe('t1')
    expect(body.keystrokes).toHaveLength(7)
    expect(body.keystrokes[0]).toEqual([0, 'c', 'c'])
    expect(body.keystrokes[6]?.[1]).toBe('t')
    expect(Number.isNaN(Date.parse(body.started_at))).toBe(false)
  })

  it('a typo shows as an error in the live stats before the run ends', async () => {
    render(<App />)
    const user = userEvent.setup()
    const input = await screen.findByRole('textbox', { name: 'Type the text above' })

    await user.type(input, 'cx')

    await waitFor(() => expect(screen.getByTestId('live-errors')).toHaveTextContent('1'))
    expect(screen.getByTestId('live-accuracy')).toHaveTextContent('50%')
  })

  it('an invalid session explains why it was not counted', async () => {
    // Same handlers as beforeEach, but the session comes back invalid.
    vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
      if (u.includes('/auth/me')) return Promise.resolve(json(USER))
      if (u.includes('/texts/random')) return Promise.resolve(json(TEXT))
      if (u.endsWith('/sessions') && init?.method === 'POST')
        return Promise.resolve(json({ ...RESULT, is_valid: false, invalid_reason: 'median_gap_too_low' }, 201))
      return Promise.resolve(json({}, 404))
    })
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: 'Type the text above' }), 'cat sat')

    expect(await screen.findByRole('heading', { name: 'Not counted' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('faster than a person can sustain')
  })

  it('a failed submit offers a retry that resends the same log', async () => {
    let attempts = 0
    vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
      if (u.includes('/auth/me')) return Promise.resolve(json(USER))
      if (u.includes('/texts/random')) return Promise.resolve(json(TEXT))
      if (u.endsWith('/sessions') && init?.method === 'POST') {
        attempts++
        if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve(json(RESULT, 201))
      }
      return Promise.resolve(json({}, 404))
    })
    render(<App />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Type the text above' }), 'cat sat')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('result-wpm')).toHaveTextContent('70')
    expect(attempts).toBe(2)
  })

  it('picking a language fetches a text in it, renders it RTL, and is remembered', async () => {
    const HE_TEXT = { ...TEXT, id: 't2', language: 'he', content: 'שלום עולם', char_count: 9 }
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
      if (u.includes('/auth/me')) return Promise.resolve(json(USER))
      if (u.includes('/texts/random')) return Promise.resolve(json(u.includes('lang=he') ? HE_TEXT : TEXT))
      return Promise.resolve(json({}, 404))
    })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'Type the text above' })
    expect(screen.getByTestId('typing-box')).toHaveAttribute('dir', 'ltr')

    await user.click(screen.getByRole('button', { name: 'עברית' }))

    await waitFor(() => expect(screen.getByTestId('typing-box')).toHaveAttribute('dir', 'rtl'))
    expect(screen.getByTestId('typing-box')).toHaveAttribute('lang', 'he')
    expect(screen.getByRole('button', { name: 'עברית' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('practice.language')).toBe('he')
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(calls.some((u) => u.includes('/texts/random') && u.includes('lang=he'))).toBe(true)
  })

  it('Next text fetches a new one and clears the result', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Type the text above' }), 'cat sat')
    await screen.findByTestId('result-wpm')

    await user.click(screen.getByRole('button', { name: 'Next text' }))

    await waitFor(() => expect(screen.queryByTestId('result-wpm')).not.toBeInTheDocument())
    const calls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes('/texts/random'))
    expect(calls.length).toBe(2)
  })
})
