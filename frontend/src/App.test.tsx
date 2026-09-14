import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows the API status and each check', async () => {
    mockFetch({ status: 'ok', checks: { db: 'ok', redis: 'ok' } })
    render(<App />)

    expect(await screen.findByTestId('status')).toHaveTextContent('ok')
    expect(screen.getByText('db: ok')).toBeInTheDocument()
    expect(screen.getByText('redis: ok')).toBeInTheDocument()
  })

  it('shows degraded when a check fails (503 still has a body)', async () => {
    mockFetch({ status: 'degraded', checks: { db: 'error', redis: 'ok' } }, 503)
    render(<App />)

    expect(await screen.findByTestId('status')).toHaveTextContent('degraded')
    expect(screen.getByText('db: error')).toBeInTheDocument()
  })

  it('shows an error when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('Failed to fetch'))))
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('API unreachable')
  })
})
