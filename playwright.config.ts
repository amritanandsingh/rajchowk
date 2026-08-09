import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests that need NO AWS account.
 *
 * The server runs against the placeholder `amplify_outputs.json`, so every
 * AppSync call fails instantly (the endpoint is 127.0.0.1:1, which refuses
 * with no DNS lookup). That is not a limitation being worked around — it is
 * the most valuable thing this suite asserts. The public pages must survive an
 * unreachable backend and render their empty state rather than a stack trace,
 * and that is precisely the "never leave the user looking at a blank screen"
 * requirement, tested against a genuinely dead backend rather than a mock.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A committed `.only` silently narrows CI to one test; fail the run instead.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Spread rather than `: undefined`. Under exactOptionalPropertyTypes an
  // explicit undefined is NOT the same as an absent key, and Playwright's type
  // rejects it — omitting the key is what actually means "use the default".
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The Indian market is mobile-first, so this is not an afterthought
      // project — a layout that overflows at 393px is a broken layout.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],

  ...(process.env.E2E_NO_SERVER === '1'
    ? {}
    : {
        webServer: {
          // `build` then `start`, not `dev`: dev-mode error overlays and
          // unminified output hide exactly the production behaviour under test.
          command: `npm run build && npx next start --port ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      }),
})
