import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'correct-horse-battery-1'

/** A pace the validator accepts: the median gap must stay above 30 ms, and the run
 *  must land under the 250 WPM review threshold however fast the runner is (ADR-015). */
export const KEY_DELAY_MS = 70

export function freshId(tag: string): { name: string; email: string } {
  // Unique display name too: the leaderboard shows names, and a row left by an
  // earlier run of this test would otherwise be matched instead of this one's.
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  return { name: `E2E ${tag} ${id}`, email: `e2e-${tag}-${id}@example.com` }
}

export async function register(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('display-name')).toHaveText(name)
}

/** Type whatever the box is showing, one key every `delay` ms, and return the text. */
export async function typeTheWholeText(page: Page, delay = KEY_DELAY_MS): Promise<string> {
  const box = page.getByTestId('typing-box')
  await expect(box).toBeVisible()
  const target = await box.innerText()
  expect(target.length).toBeGreaterThan(10)
  await page.getByRole('textbox', { name: 'Type the text above' }).click()
  await page.keyboard.type(target, { delay })
  return target
}
