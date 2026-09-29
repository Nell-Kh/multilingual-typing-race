import { expect, test } from '@playwright/test'
import { typeTheWholeText } from './helpers'

/**
 * The path a visitor takes alone (ADR-034): the landing page, "Try it now", a run
 * scored by the real server, and nothing kept — no account, no token, no row.
 */
test('a visitor tries it without an account: scored by the server, not saved', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Try it now' }).click()

  await expect(page).toHaveURL(/\/try$/)
  await expect(page.getByTestId('guest-banner')).toHaveText(
    'Guest run — not saved. Create an account to keep your stats.',
  )
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'العربية', exact: true }).click()

  const scored = page.waitForResponse((r) => r.url().endsWith('/api/v1/sessions/guest') && r.request().method() === 'POST')
  await typeTheWholeText(page)
  const response = await scored
  expect(response.status()).toBe(200)
  expect((await response.json()).saved).toBe(false)
  expect(response.request().headers()['authorization']).toBeUndefined()

  await expect(page.getByTestId('result-status')).toHaveText('Valid · not saved')
  const wpm = Number((await page.getByTestId('result-wpm').innerText()).replace(/[^\d.]/g, ''))
  expect(wpm).toBeGreaterThan(0)

  // Still a guest: the account pages send you to log in.
  await page.goto('/stats')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})
