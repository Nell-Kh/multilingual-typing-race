import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAccessToken, refreshAccessToken, setAccessToken } from './api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const TOKENS = { access_token: 'fresh', token_type: 'bearer', expires_in: 900 }

beforeEach(() => setAccessToken(null))
afterEach(() => vi.unstubAllGlobals())

/**
 * Refreshing rotates the token (ADR-009): the first request spends the cookie, so a
 * second one sent at the same time asks with a token that no longer exists and is
 * rejected — and its failure used to clear the access token the first call had just
 * set. Three stats queries retrying together after expiry is enough to trigger it.
 */
it('runs one refresh at a time and gives every caller the same answer', async () => {
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++
      // What a rotating endpoint does to a second, parallel attempt.
      if (calls > 1) return json({ error: { code: 'unauthorized', message: 'spent' } }, 401)
      await new Promise((r) => setTimeout(r, 20))
      return json(TOKENS)
    }),
  )

  const results = await Promise.all([
    refreshAccessToken(),
    refreshAccessToken(),
    refreshAccessToken(),
  ])

  expect(calls).toBe(1)
  expect(results).toEqual(['fresh', 'fresh', 'fresh'])
  expect(getAccessToken()).toBe('fresh')
})

it('refreshes again once the first one has finished', async () => {
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++
      return json({ ...TOKENS, access_token: `token${calls}` })
    }),
  )

  expect(await refreshAccessToken()).toBe('token1')
  expect(await refreshAccessToken()).toBe('token2')
  expect(calls).toBe(2)
})

it('clears the access token when the refresh cookie is no longer good', async () => {
  setAccessToken('stale')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error: { code: 'unauthorized', message: 'no' } }, 401)),
  )

  expect(await refreshAccessToken()).toBeNull()
  expect(getAccessToken()).toBeNull()
})
