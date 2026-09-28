import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useAuth } from '../features/auth/store'
import { setAccessToken } from '../lib/api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER = { id: 'u1', email: 'n@x.com', display_name: 'nell', role: 'user', preferred_language: 'en', created_at: '' }

beforeEach(() => {
  cleanup()
  localStorage.clear()
  setAccessToken('tok')
  useAuth.setState({ status: 'authenticated', user: USER as never })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/auth/refresh')) return Promise.resolve(json({ access_token: 'tok', token_type: 'bearer', expires_in: 900 }))
      if (u.includes('/auth/me')) return Promise.resolve(json(USER))
      if (u.includes('/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(json({ error: { code: 'x', message: 'x' } }, 404))
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function go(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
}

describe('app header', () => {
  it('names the product and links the five places, marking the current one', async () => {
    go('/stats')
    const nav = await screen.findByRole('navigation', { name: 'Main' })

    const links = within(nav).getAllByRole('link').map((a) => a.textContent)
    expect(links).toEqual(['Practice', 'Race', 'Daily', 'Stats', 'Leaderboard'])
    expect(within(nav).getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Race' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Keyrace' })).toHaveAttribute('href', '/')
    await waitFor(() => expect(document.title).toBe('Your stats · Keyrace'))
  })

  it('tells Practice and Daily apart, though both live on /practice', async () => {
    go('/practice?daily=1&lang=he')
    const nav = await screen.findByRole('navigation', { name: 'Main' })

    expect(within(nav).getByRole('link', { name: 'Daily' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Practice' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'Daily' }).getAttribute('href')).toMatch(/^\/practice\?daily=1&lang=/)
  })

  it('shows your initial, and the menu behind it logs you out', async () => {
    go('/stats')
    const user = userEvent.setup()

    const account = await screen.findByRole('button', { name: 'Account: nell' })
    expect(account).toHaveTextContent('N')
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()

    await user.click(account)
    const menu = screen.getByTestId('user-menu')
    expect(menu).toHaveTextContent('Signed in as nell')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()

    await user.click(account)
    await user.click(within(screen.getByTestId('user-menu')).getByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    // Signed out, the header keeps the name and nothing you cannot use yet.
    expect(screen.getByRole('link', { name: 'Keyrace' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })
})
