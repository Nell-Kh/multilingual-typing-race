import { expect, test, type Locator, type Page } from '@playwright/test'
import { freshId, register, typeTheWholeText } from './helpers'

/**
 * A whole race between two real browsers over the real WebSocket: one player opens a
 * room, the other joins by its code, the server counts down, both type the text, and
 * both see the same results table, whose places, speeds and times are the server's.
 *
 * The typing is scripted at a fixed pace per player, so the order is not luck: the
 * host types a key every 80 ms and the guest every 130 ms, which on any text in the
 * corpus puts seconds between their finishes. Both paces are inside what the
 * validator accepts from a person (ADR-015), so both runs must be counted.
 */

const HOST_DELAY_MS = 80
const GUEST_DELAY_MS = 130

/** "8.7s" → 8.7; anything else (an estimate, a dash) fails the test. */
function exactSeconds(cell: string): number {
  expect(cell.trim()).toMatch(/^\d+\.\ds$/)
  return Number.parseFloat(cell)
}

/** The table view of the results: [place, name, wpm, accuracy, time, counted] per row. */
async function resultRows(page: Page): Promise<string[][]> {
  const results = page.getByRole('region', { name: 'results' })
  await expect(results).toBeVisible({ timeout: 90_000 })
  const rows: Locator = results.locator('tbody tr')
  await expect(rows).toHaveCount(2)
  return Promise.all(
    (await rows.all()).map(async (row) => (await row.locator('td').allInnerTexts()).map((t) => t.trim())),
  )
}

test('two players race: create, join, countdown, both finish, one results table', async ({ browser }) => {
  // Two contexts are two separate sign-ins, like two people on two devices.
  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  const hostId = freshId('host')
  const guestId = freshId('guest')
  await register(host, hostId.name, hostId.email)
  await register(guest, guestId.name, guestId.email)

  // The host opens an English room.
  await host.goto('/race')
  await host.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'English', exact: true }).click()
  await host.getByRole('group', { name: 'Difficulty' }).getByRole('button', { name: '1', exact: true }).click()
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForURL(/\/race\/[A-Z0-9]{6}$/)
  const code = new URL(host.url()).pathname.split('/').pop() ?? ''

  // The guest joins by typing the code, as a friend would.
  await guest.goto('/race')
  await guest.getByPlaceholder('ABC123').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await guest.waitForURL(new RegExp(`/race/${code}$`))

  const lobby = host.getByRole('region', { name: 'lobby' })
  await expect(lobby.getByRole('list', { name: 'players' }).getByRole('listitem')).toHaveCount(2)
  await expect(lobby).toContainText(guestId.name)
  await host.getByRole('button', { name: 'Start race' }).click()

  // Both see the server's countdown, and neither can type until it ends.
  for (const page of [host, guest]) {
    await expect(page.getByTestId('countdown')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Type the text above' })).toBeDisabled()
  }
  for (const page of [host, guest]) {
    await expect(page.getByRole('textbox', { name: 'Type the text above' })).toBeEnabled({ timeout: 15_000 })
  }

  const [hostText, guestText] = await Promise.all([
    typeTheWholeText(host, HOST_DELAY_MS),
    typeTheWholeText(guest, GUEST_DELAY_MS),
  ])
  expect(guestText).toBe(hostText) // one text for the whole room

  const seenByHost = await resultRows(host)
  const seenByGuest = await resultRows(guest)

  const [first, second] = seenByHost
  expect(first[0]).toBe('#1')
  expect(first[1]).toContain(hostId.name)
  expect(second[0]).toBe('#2')
  expect(second[1]).toContain(guestId.name)
  for (const row of seenByHost) {
    expect(Number(row[2])).toBeGreaterThan(0)
    expect(row[5]).toBe('counted')
  }
  // Exact times from the server (ADR-033), and the faster typist took less time.
  expect(exactSeconds(first[4])).toBeLessThan(exactSeconds(second[4]))

  // The other player sees exactly the same table: nothing is measured locally.
  expect(seenByGuest).toEqual(seenByHost)

  await hostCtx.close()
  await guestCtx.close()
})
