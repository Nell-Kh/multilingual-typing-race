import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { setAccessToken } from '../../lib/api'
import { useAuth } from './store'

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER = {
  id: 'u1',
  email: 'nell@example.com',
  display_name: 'Nell',
  role: 'user',
  preferred_language: 'en',
  created_at: '2026-09-16T00:00:00Z',
}

function mockApi(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => handler(url, init)),
  )
}

beforeEach(() => {
  cleanup()
  setAccessToken(null)
  useAuth.setState({ status: 'unknown', user: null })
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settled = () => waitFor(() => expect(useAuth.getState().status).not.toBe('unknown'))

describe('auth flow', () => {
  it('sends an anonymous visitor to /login', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('restores the session from the refresh cookie on load', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ access_token: 't1', token_type: 'bearer', expires_in: 900 })
      if (url.endsWith('/auth/me')) return json(USER)
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)
    await settled()

    expect(await screen.findByTestId('display-name')).toHaveTextContent('Nell')
  })

  it('logs in, then sends the bearer token on later requests', async () => {
    const seen: string[] = []
    mockApi((url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/login')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 })
      if (url.endsWith('/auth/me')) {
        seen.push(headers['Authorization'] ?? '')
        return json(USER)
      }
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Log in' })
    await user.type(screen.getByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByTestId('display-name')).toHaveTextContent('Nell')
    expect(seen).toEqual(['Bearer tok'])
  })

  it('shows the API error message on a bad login', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/login'))
        return json({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }, 401)
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Log in' })
    await user.type(screen.getByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong wrong wrong')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
  })

  it('refreshes once and replays the request when the access token expires', async () => {
    let meCalls = 0
    mockApi((url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (url.endsWith('/auth/refresh')) return json({ access_token: `t${++meCalls}`, token_type: 'bearer', expires_in: 900 })
      if (url.endsWith('/auth/me')) {
        // First call arrives with the stale token and is rejected; the retry succeeds.
        return headers['Authorization'] === 'Bearer stale' ? json({ error: {} }, 401) : json(USER)
      }
      throw new Error(`unexpected ${url}`)
    })
    setAccessToken('stale')
    useAuth.setState({ status: 'authenticated', user: USER as never })

    const { request } = await import('../../lib/api')
    const me = await request<typeof USER>('/api/v1/auth/me')

    expect(me.display_name).toBe('Nell')
  })

  it('logs out: clears the user and goes back to /login', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ access_token: 't', token_type: 'bearer', expires_in: 900 })
      if (url.endsWith('/auth/me')) return json(USER)
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)
    await settled()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument())
  })
})
