import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3000)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

// `mocked` projects intercept the AppSync endpoint and need no AWS at all, so
// they can gate CI. `live` projects require a deployed `ampx sandbox`.
const runLive = process.env.E2E_LIVE === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Spread rather than `: undefined` — exactOptionalPropertyTypes is on, so an
  // explicit undefined is not assignable to an optional property. Omitting the
  // key lets Playwright apply its own default (half the CPU count).
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'hi-IN',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    // ---- Mocked: no AWS required. Public pages, a11y, layout gates. --------
    {
      name: 'mocked-mobile',
      testMatch: /mocked\/.*\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mocked-a11y',
      testMatch: /a11y\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mocked-overflow',
      testMatch: /layout\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ---- Live: requires a deployed sandbox backend. -----------------------
    ...(runLive
      ? [
          {
            name: 'live-setup',
            testMatch: /live\/setup\.ts/,
          },
          {
            name: 'live-mobile',
            testMatch: /live\/.*\.spec\.ts/,
            dependencies: ['live-setup'],
            use: { ...devices['Pixel 7'] },
          },
          {
            name: 'live-desktop',
            testMatch: /live\/.*\.spec\.ts/,
            dependencies: ['live-setup'],
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
  ],

  // Docs recommend testing a production build; `next dev` is used locally for speed.
  ...(process.env.E2E_NO_SERVER
    ? {}
    : {
        webServer: {
          command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      }),
})
