import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
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
      if (url.includes('/me/keys')) return json({ language: 'en', keys: [] })
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
    // A first run is seconds long; rounding it to "0 min" reads as "nothing here".
    expect(screen.getByTestId('lang-he')).toHaveTextContent('37 s')
    expect(screen.getByTestId('trend')).toHaveAttribute('aria-label', 'WPM over the last 2 runs, latest 72.5')

    expect(await screen.findByTestId('run-s1')).toHaveTextContent('counted')
    expect(screen.getByTestId('run-s1')).not.toHaveTextContent('not counted')
    expect(screen.getByTestId('run-card-s1')).toHaveTextContent('72.5 wpm') // the phone layout
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByTestId('run-s3')).toHaveTextContent('not counted')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(requested.some((u) => u.includes('/me/sessions?cursor=abc'))).toBe(true)
  })
})

describe('when a part of the page fails to load', () => {
  it('says the history failed instead of showing it as empty', async () => {
    vi.mocked(fetch).mockImplementation((async (url: string) => {
      const u = String(url)
      if (u.includes('/auth/refresh'))
        return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (u.includes('/auth/me')) return json(ME)
      if (u.includes('/me/stats')) return json({ languages: [], trend: [] })
      if (u.includes('/me/keys')) return json({ language: 'en', keys: [] })
      if (u.includes('/me/sessions'))
        return json({ error: { code: 'server_error', message: 'Could not reach the database' } }, 500)
      throw new Error(`unexpected ${u}`)
    }) as typeof fetch)

    window.history.pushState({}, '', '/stats')
    render(<App />)

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent('Could not reach the database')
    expect(screen.queryByText('Nothing yet.')).not.toBeInTheDocument()
  }, 10000)
})

describe('signing in as somebody else', () => {
  /**
   * The query cache is keyed by what was asked for, not by who asked. On a shared
   * browser that meant the next person to sign in was shown the last person's numbers
   * until their own request came back — seconds of it on a slow connection.
   */
  it('never shows the previous account the numbers of the one before it', async () => {
    const OTHER = { ...ME, id: 'other', display_name: 'Sami' }
    let releaseSecondStats: (() => void) | undefined
    let statsCalls = 0
    let signedIn = ME

    vi.mocked(fetch).mockImplementation((async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/auth/refresh'))
        return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (u.includes('/auth/logout')) return new Response(null, { status: 204 })
      if (u.includes('/auth/login')) {
        signedIn = OTHER
        return json({ access_token: 'tok2', token_type: 'bearer', expires_in: 900 })
      }
      if (u.includes('/auth/me')) return json(signedIn)
      if (u.includes('/me/stats')) {
        statsCalls++
        if (statsCalls === 1) return json(STATS)
        // The second account's stats never arrive during this test: whatever is on
        // screen in the meantime is what the cache decided to show.
        return new Promise<Response>((resolve) => {
          releaseSecondStats = () => resolve(json({ languages: [], trend: [] }))
        })
      }
      if (u.includes('/me/keys')) return json({ language: 'en', keys: [] })
      if (u.includes('/me/sessions')) return json({ items: [], next_cursor: null })
      if (u.includes('/leaderboards')) return json(BOARD)
      throw new Error(`unexpected ${u} ${init?.method ?? ''}`)
    }) as typeof fetch)

    window.history.pushState({}, '', '/stats')
    render(<App />)
    const user = userEvent.setup()
    expect(await screen.findByTestId('lang-en')).toHaveTextContent('72.5 wpm')

    await user.click(screen.getByRole('button', { name: /^Account:/ }))
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await user.type(await screen.findByLabelText('Email'), 'sami@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await user.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Stats' }))

    expect(screen.queryByTestId('lang-en')).not.toBeInTheDocument()
    expect(screen.queryByText(/72\.5 wpm/)).not.toBeInTheDocument()
    releaseSecondStats?.()
    expect(await screen.findByText(/No counted runs yet/)).toBeInTheDocument()
  })
})

describe('stats page when there is nothing yet', () => {
  it('tells a new player, in plain words, where the numbers will come from', async () => {
    vi.mocked(fetch).mockImplementation((async (url: string) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (u.includes('/auth/me')) return json(ME)
      if (u.includes('/me/stats')) return json({ languages: [], trend: [] })
      if (u.includes('/me/keys')) return json({ language: 'en', keys: [] })
      if (u.includes('/me/sessions')) return json({ items: [], next_cursor: null })
      throw new Error(`unexpected ${u}`)
    }) as typeof fetch)
    window.history.pushState({}, '', '/stats')
    render(<App />)

    const empty = await screen.findByTestId('stats-empty')
    expect(empty).toHaveTextContent('No counted runs yet')
    expect(empty).toHaveTextContent('Finish a practice run and this page fills in')
    expect(within(empty).getByRole('link', { name: 'Start practice' })).toHaveAttribute('href', '/practice')
    // One message, not an empty card per section.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'history' })).not.toBeInTheDocument())
    expect(screen.queryByTestId('trend')).not.toBeInTheDocument()
  })
})

describe('leaderboard page', () => {
  function serveBoard(board: unknown) {
    vi.mocked(fetch).mockImplementation((async (url: string) => {
      const u = String(url)
      requested.push(u)
      if (u.includes('/auth/refresh')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (u.includes('/auth/me')) return json(ME)
      if (u.includes('/leaderboards')) return json(board)
      throw new Error(`unexpected ${u}`)
    }) as typeof fetch)
  }

  it('lists the board, and switches period with tabs and language with the segmented control', async () => {
    window.history.pushState({}, '', '/leaderboard')
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByTestId('row-o1')).toHaveTextContent('Sami')
    const tabs = screen.getByRole('tablist', { name: 'Period' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All-time', 'Weekly', 'Daily'])
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'All-time' }))
    await waitFor(() => expect(requested.some((u) => u.includes('/leaderboards?lang=en&period=all'))).toBe(true))
    expect(screen.getByRole('tab', { name: 'All-time' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-all')

    // Arrow keys move along the tabs, as in any tab list.
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveFocus()
    await waitFor(() => expect(requested.some((u) => u.includes('/leaderboards?lang=en&period=day'))).toBe(true))

    await user.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'العربية' }))
    await waitFor(() => expect(requested.some((u) => u.includes('/leaderboards?lang=ar&period=day'))).toBe(true))
  })

  it('pins your own row at the bottom when you are outside the top', async () => {
    window.history.pushState({}, '', '/leaderboard')
    render(<App />)

    const mine = await screen.findByTestId('row-pinned')
    expect(mine).toHaveAttribute('data-pinned', 'true')
    expect(mine).toHaveAttribute('aria-current', 'true')
    expect(mine).toHaveTextContent('7')
    expect(mine).toHaveTextContent('Nellyou')
    expect(mine.className).toContain('sticky')
    // It comes after the top rows, not among them.
    const rows = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-rank'))
    expect(rows.map((r) => r.getAttribute('data-rank'))).toEqual(['1', '2', '7'])
  })

  it('highlights your row in place, unpinned, when you are in the top', async () => {
    serveBoard({
      ...BOARD,
      rows: [...BOARD.rows, { rank: 3, user_id: 'me', display_name: 'Nell', wpm: 61, accuracy: 96, started_at: '' }],
      me: { rank: 3, user_id: 'me', display_name: 'Nell', wpm: 61, accuracy: 96, started_at: '' },
    })
    window.history.pushState({}, '', '/leaderboard')
    render(<App />)

    const inPlace = await screen.findByTestId('row-me') // the row for user id "me"
    expect(inPlace).toHaveAttribute('data-rank', '3')
    expect(inPlace).toHaveAttribute('aria-current', 'true')
    expect(inPlace).not.toHaveAttribute('data-pinned')
    expect(screen.queryByTestId('row-pinned')).not.toBeInTheDocument()
  })

  it('shows tied players with the same rank, exactly as the server ranked them', async () => {
    serveBoard({
      ...BOARD,
      rows: [
        { rank: 1, user_id: 'a', display_name: 'Maya', wpm: 90, accuracy: 99, started_at: '' },
        { rank: 2, user_id: 'b', display_name: 'Omar', wpm: 80, accuracy: 98, started_at: '' },
        { rank: 2, user_id: 'c', display_name: 'Lior', wpm: 80, accuracy: 97, started_at: '' },
        { rank: 4, user_id: 'd', display_name: 'Dana', wpm: 70, accuracy: 96, started_at: '' },
      ],
      me: null,
    })
    window.history.pushState({}, '', '/leaderboard')
    render(<App />)

    await screen.findByTestId('row-d')
    const ranks = ['a', 'b', 'c', 'd'].map((id) => within(screen.getByTestId(`row-${id}`)).getAllByRole('cell')[0].textContent)
    expect(ranks).toEqual(['1', '2', '2', '4'])
    expect(screen.queryByTestId('row-pinned')).not.toBeInTheDocument()
  })

  it('says so in plain words when nobody is on the board, and offers the way on', async () => {
    serveBoard({ language: 'he', period: 'week', rows: [], me: null })
    window.history.pushState({}, '', '/leaderboard?lang=he')
    render(<App />)
    const user = userEvent.setup()

    const empty = await screen.findByTestId('board-empty')
    expect(empty).toHaveTextContent('No counted runs in עברית this week.')
    expect(empty).toHaveTextContent('Finish a run and you will be first on this board.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(within(empty).getByRole('link', { name: 'Start practice' }))
    // Practice opens in the remembered language, so the board's language is remembered first.
    expect(localStorage.getItem('practice.language')).toBe('he')
  })
})
