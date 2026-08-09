import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3000)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

/**
 * `mocked` projects need no AWS and therefore gate CI.
 *
 * The name is historical and slightly misleading: nothing is intercepted. They
 * run against the placeholder amplify_outputs.json written by
 * `npm run ci:outputs`, whose endpoints point at 127.0.0.1:1. Every AppSync
 * call fails fast, `unwrap()` in src/lib/amplify/queries.ts logs it and returns
 * null, and the pages render their empty states. That is sufficient because
 * these specs assert chrome only — navigation, headings, form labels, the
 * branded 404, axe violations and horizontal overflow — never article content.
 *
 * The tradeoff is real and deliberate: a11y and overflow are verified against
 * EMPTY pages, so a violation that only appears with real content will not be
 * caught here. That is what the `live` projects are for — they run against a
 * populated deployed environment via E2E_BASE_URL.
 */
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
  //
  // The `-p ${PORT}` is load-bearing. baseURL above is derived from E2E_PORT,
  // but `next dev` / `next start` default to 3000 regardless, so without it
  // E2E_PORT=4000 made Playwright poll :4000 while Next served :3000 and the
  // run died at the 180s webServer timeout with no useful diagnostic.
  ...(process.env.E2E_NO_SERVER
    ? {}
    : {
        webServer: {
          command: process.env.CI
            ? `npm run build && npm run start -- -p ${PORT}`
            : `npm run dev -- -p ${PORT}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      }),
})
