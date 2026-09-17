import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAccessToken } from '../../lib/api'
import { useAuth } from '../auth/store'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ME = { id: 'me', email: 'n@x.com', display_name: 'Nell', role: 'user', preferred_language: 'en', created_at: '' }
const STATS = {
  languages: [
    { language: 'en', runs: 4, best_wpm: 72.5, avg_wpm: 61.2, avg_accuracy: 96.1, total_time_ms: 240000 },
    { language: 'he', runs: 1, best_wpm: 31.3, avg_wpm: 31.3, avg_accuracy: 96, total_time_ms: 36800 },
  ],
  trend: [
    { started_at: '2026-09-16T10:00:00Z', language: 'en', mode: 'practice', wpm: 50, accuracy: 95 },
    { started_at: '2026-09-17T10:00:00Z', language: 'en', mode: 'race', wpm: 72.5, accuracy: 97 },
  ],
}
const run = (id: string, wpm: number, valid = true) => ({
  id, text_id: 't', mode: 'practice', language: 'en', started_at: '2026-09-17T10:00:00Z',
  finished_at: '', duration_ms: 1000, wpm, cpm: 0, raw_wpm: wpm, accuracy: 100, error_count: 0,
  keystroke_count: 10, is_valid: valid, invalid_reason: null, created_at: '',
})
const BOARD = {
  language: 'en', period: 'week',
  rows: [
    { rank: 1, user_id: 'o1', display_name: 'Sami', wpm: 90, accuracy: 99, started_at: '' },
    { rank: 2, user_id: 'o2', display_name: 'Dana', wpm: 80, accuracy: 98, started_at: '' },
  ],
  me: { rank: 7, user_id: 'me', display_name: 'Nell', wpm: 61, accuracy: 96, started_at: '' },
}

let requested: string[]

beforeEach(() => {
  cleanup()
  requested = []
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: ME as never })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requested.push(url)
      if (url.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (url.includes('/auth/me')) return json(ME)
      if (url.includes('/me/stats')) return json(STATS)
      if (url.includes('/me/sessions')) {
        return url.includes('cursor=')
          ? json({ items: [run('s3', 40, false)], next_cursor: null })
          : json({ items: [run('s1', 72.5), run('s2', 50)], next_cursor: 'abc' })
      }
      if (url.includes('/leaderboards')) return json({ ...BOARD, period: new URL(url).searchParams.get('period') })
      throw new Error(`unexpected ${url}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('stats page', () => {
  it('shows per-language numbers, the trend and paginated history', async () => {
    window.history.pushState({}, '', '/stats')
    render(<App />)
    const user = userEvent.setup()

    const en = await screen.findByTestId('lang-en')
    expect(en).toHaveTextContent('72.5 wpm')
    expect(en).toHaveTextContent('4 min')
    expect(screen.getByTestId('lang-he')).toHaveTextContent('31.3 wpm')
    expect(screen.getByTestId('trend')).toHaveAttribute('aria-label', 'WPM over the last 2 runs, latest 72.5')

    expect(await screen.findByTestId('run-s1')).toHaveTextContent('yes')
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByTestId('run-s3')).toHaveTextContent('no')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(requested.some((u) => u.includes('/me/sessions?cursor=abc'))).toBe(true)
  })
})

describe('leaderboard page', () => {
  it('lists the board, marks you outside the top, and switches period and language', async () => {
    window.history.pushState({}, '', '/leaderboard')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByTestId('row-1')).toHaveTextContent('Sami')
    expect(screen.getByTestId('row-me')).toHaveTextContent('7')
    expect(screen.getByTestId('row-me')).toHaveTextContent('Nell(you)')

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() =>
      expect(requested.some((u) => u.includes('/leaderboards?lang=en&period=all'))).toBe(true),
    )
    await user.click(screen.getByRole('button', { name: 'العربية' }))
    await waitFor(() =>
      expect(requested.some((u) => u.includes('/leaderboards?lang=ar&period=all'))).toBe(true),
    )
  })
})
