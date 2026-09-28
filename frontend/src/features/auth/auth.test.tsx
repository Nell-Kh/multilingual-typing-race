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
  it('sends an anonymous visitor to /login from a page that needs an account', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/stats')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows a visitor the landing page at /, with a way in', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      throw new Error(`unexpected ${url}`)
    })
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.getByTestId('tagline')).toHaveTextContent('Type in English · עברית · العربية')
    expect(screen.getByText(/replays every keystroke/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
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
    window.history.pushState({}, '', '/login')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Log in' })
    await user.type(screen.getByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByTestId('display-name')).toHaveTextContent('Nell')
    expect(seen).toEqual(['Bearer tok'])
  })

  it('says what it is doing while the login is in flight, and cannot be sent twice', async () => {
    let answer: (r: Response) => void = () => {}
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/login')) return new Promise<Response>((resolve) => (answer = resolve))
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/login')
    render(<App />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Log in' })
    await user.type(screen.getByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    const busy = await screen.findByRole('button', { name: 'Logging in…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    answer(json({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }, 401))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  it('shows the API error message on a bad login', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/login'))
        return json({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }, 401)
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/login')
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

    await user.click(await screen.findByRole('button', { name: 'Account: Nell' }))
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument())
  })

  it('puts a wrong password message under the password field, in words', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/login'))
        return json({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } }, 401)
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/login')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.keyboard('{Enter}') // Enter submits

    const message = await screen.findByRole('alert')
    expect(message).toHaveTextContent('Email or password is incorrect.')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-describedby', message.id)
  })

  it('checks the register form before sending anything', async () => {
    const calls: string[] = []
    mockApi((url) => {
      calls.push(url)
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/register')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual([
      'Enter the name other players will see.',
      'That doesn’t look like an email address (name@example.com).',
      'Use at least 8 characters.',
    ])
    expect(calls.filter((u) => u.includes('/auth/register'))).toEqual([])
    expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('says under the email field when the address already has an account', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return json({ error: {} }, 401)
      if (url.endsWith('/auth/register'))
        return json({ error: { code: 'email_taken', message: 'An account with this email already exists' } }, 409)
      throw new Error(`unexpected ${url}`)
    })
    window.history.pushState({}, '', '/register')
    render(<App />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Display name'), 'Nell')
    await user.type(screen.getByLabelText('Email'), 'nell@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const message = await screen.findByRole('alert')
    expect(message).toHaveTextContent('There is already an account with this email.')
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', message.id)
  })
})
