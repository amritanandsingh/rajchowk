import { expect, test } from '@playwright/test'

/**
 * Precondition gate for the `live` projects.
 *
 * playwright.config.ts registers this as the `live-setup` project and makes
 * live-mobile / live-desktop depend on it, so a misconfigured target fails once
 * here with a readable message instead of producing a wall of identical
 * timeouts across every spec.
 *
 * Deliberately anonymous and read-only. An earlier design signed in a seeded
 * member and saved storage state, but the whole point of this suite is that it
 * can be pointed at PRODUCTION, and no test run should ever create a user or
 * write a row there. Authenticated behaviour is covered by
 * `npm run test:integration` against a sandbox, which is the only environment
 * where minting role tokens is possible at all.
 */
test('target environment is reachable and is a Raj Chowk deployment', async ({ page, baseURL }) => {
  expect(baseURL, 'No baseURL. Run with E2E_BASE_URL=<url> E2E_NO_SERVER=1 E2E_LIVE=1').toBeTruthy()

  const response = await page.goto('/')
  expect(response?.status(), `${baseURL}/ did not return 200`).toBe(200)

  // The brand link is the cheapest proof this is our app and not a parked
  // domain, a WAF block page or someone else's default nginx.
  await expect(page.getByRole('link', { name: 'राज चौक', exact: true })).toBeVisible()
})
