import { expect, test, type Page } from '@playwright/test'

/**
 * One journey, end to end, through the built frontend and the real API:
 * register → practice run → the server scores it → it shows up on the leaderboard.
 * Then the daily challenge from the home card, which is the exact path that broke
 * in #29 while every unit test on both sides passed.
 *
 * Deliberately not a unit test in disguise: nothing here stubs a response, and the
 * numbers asserted are the ones the server computed from the keystroke log.
 */

const PASSWORD = 'correct-horse-battery-1'

/** A pace the validator accepts: the median gap must stay above 30 ms, and the run
 *  must land under the 250 WPM review threshold however fast the runner is (ADR-015). */
const KEY_DELAY_MS = 70

function freshId(tag: string): { name: string; email: string } {
  // Unique display name too: the leaderboard shows names, and a row left by an
  // earlier run of this test would otherwise be matched instead of this one's.
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  return { name: `E2E ${tag} ${id}`, email: `e2e-${tag}-${id}@example.com` }
}

async function register(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('display-name')).toHaveText(name)
}

/** Type whatever the box is showing, at a human pace, and return the text. */
async function typeTheWholeText(page: Page): Promise<string> {
  const box = page.getByTestId('typing-box')
  await expect(box).toBeVisible()
  const target = await box.innerText()
  expect(target.length).toBeGreaterThan(10)
  await page.getByRole('textbox', { name: 'Type the text above' }).click()
  await page.keyboard.type(target, { delay: KEY_DELAY_MS })
  return target
}

test('register, practise, get scored, appear on the leaderboard', async ({ page }) => {
  const { name, email } = freshId('practice')
  await register(page, name, email)

  await page.getByRole('link', { name: 'Practice' }).click()
  await typeTheWholeText(page)

  // The result card is the server's answer, not the live counter's.
  const wpm = page.getByTestId('result-wpm')
  await expect(wpm).toBeVisible()
  const scored = Number((await wpm.innerText()).replace(/[^\d.]/g, ''))
  expect(scored).toBeGreaterThan(0)
  // A run typed at a human pace must be counted, not flagged.
  await expect(page.getByText('Not counted')).toHaveCount(0)

  await page.goto('/leaderboard')
  const myRow = page.locator('tbody tr', { hasText: name }).first()
  await expect(myRow).toBeVisible()
  await expect(myRow).toContainText(String(Math.trunc(scored)))
})

test('the daily challenge opens from the home card and can be typed', async ({ page }) => {
  const { name, email } = freshId('daily')
  await register(page, name, email)

  const card = page.getByTestId('daily-card')
  await expect(card).toBeVisible()
  const preview = (await card.innerText()).split('\n').filter(Boolean)[1] ?? ''

  await page.getByRole('link', { name: "Type today's text" }).click()
  await expect(page.getByRole('heading', { name: 'Daily challenge' })).toBeVisible()

  // Same text as the card advertised, and a box that actually rendered it (#29).
  const target = await typeTheWholeText(page)
  expect(target.slice(0, 20)).toBe(preview.replace(/…$/, '').slice(0, 20))

  await expect(page.getByTestId('result-wpm')).toBeVisible()
  await page.getByRole('link', { name: "See today's leaderboard" }).click()
  await expect(page.getByRole('heading', { name: "Today's challenge" })).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: name }).first()).toBeVisible()
})

test('a page reload keeps you signed in', async ({ page }) => {
  // The access token lives in memory, so a reload has nothing but the refresh
  // cookie to go on: its path, its SameSite, the rotation and the bootstrap call
  // all have to be right or this fails. (It does not cover two refreshes racing —
  // that needs concurrency this test has no way to force; api.test.ts covers it.)
  const { name, email } = freshId('reload')
  await register(page, name, email)

  await page.reload()

  await expect(page.getByTestId('display-name')).toHaveText(name)
})
