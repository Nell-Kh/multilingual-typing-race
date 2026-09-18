import { defineConfig, devices } from '@playwright/test'

/**
 * The smoke test drives the *built* frontend against a running API, because the
 * bugs it exists to catch live between the two (PR #29: the home page and the
 * practice page disagreeing about a cached shape, which every unit test on both
 * sides was happy with).
 *
 * The API is started by the workflow before this runs — it needs Postgres, Redis,
 * migrations and the seed corpus, which is CI's job, not Playwright's. The web
 * server is started here because it is one command and Playwright can wait for it.
 */
const WEB_PORT = Number(process.env.WEB_PORT ?? 4173)

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.WEB_URL
    ? undefined
    : {
        command: `npm --prefix ../frontend run preview -- --port ${WEB_PORT} --strictPort`,
        url: `http://localhost:${WEB_PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
