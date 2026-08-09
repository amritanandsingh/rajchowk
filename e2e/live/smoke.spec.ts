import { expect, test } from '@playwright/test'

/**
 * Deployed-environment smoke suite.
 *
 * Runs against ANY environment via
 *   E2E_NO_SERVER=1 E2E_BASE_URL=<url> E2E_LIVE=1 npm run e2e:live
 *
 * This is the only automated coverage that touches a real deployment. It exists
 * because `npm run test:integration` and `npm run verify:backend` structurally
 * cannot run against main — amplify/backend.ts withholds
 * ALLOW_ADMIN_USER_PASSWORD_AUTH from production, so there is no way to mint a
 * role token there.
 *
 * It complements `npm run verify:parity`, which checks the same deployments at
 * the HTTP level. The overlap is intentional: this one runs a real browser, so
 * it catches hydration errors, client-side exceptions and layout breakage that
 * a header diff cannot see.
 *
 * Everything here is anonymous and read-only, so it is safe against production.
 * Unlike the `mocked` projects, these pages carry REAL CONTENT — which is what
 * makes the a11y and overflow assertions meaningful. The mocked suite verifies
 * empty states; this verifies populated ones.
 */

const PUBLIC_ROUTES = [
  ['/', null],
  ['/latest', 'ताज़ा'],
  ['/opinion', 'राज चौक की राय'],
  ['/janmat', 'जनमत'],
  ['/ask', 'राज चौक से पूछें'],
  ['/promises', 'वादा ट्रैकर'],
  ['/live', 'लाइव चर्चा'],
  ['/videos', 'वीडियो'],
  ['/about', 'हमारे बारे में'],
] as const

test('every public route returns 200 and renders its heading', async ({ page }) => {
  for (const [path, heading] of PUBLIC_ROUTES) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} status`).toBe(200)
    if (heading) {
      await expect(
        page.getByRole('heading', { name: heading, exact: true }).first(),
        `${path} heading`,
      ).toBeVisible()
    }
  }
})

test('public pages raise no uncaught client-side errors', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  })

  for (const [path] of PUBLIC_ROUTES) {
    await page.goto(path)
    // Deliberately NOT waitForLoadState('networkidle'): Playwright discourages
    // it, and on a real deployment nine routes of it exceeded the 45s test
    // timeout. Hydration errors surface within a frame or two of the initial
    // paint, so a short bounded settle is both sufficient and predictable.
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(400)
  }

  expect(problems, `client-side errors:\n${problems.join('\n')}`).toEqual([])
})

test('populated pages do not overflow horizontally', async ({ page }) => {
  for (const [path] of PUBLIC_ROUTES) {
    await page.goto(path)
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(dimensions.scroll, `${path} overflows`).toBeLessThanOrEqual(dimensions.client)
  }
})

test('syndication endpoints are well formed', async ({ request }) => {
  for (const [path, root] of [
    ['/feed.xml', 'rss'],
    ['/sitemap.xml', 'urlset'],
    ['/news-sitemap.xml', 'urlset'],
  ] as const) {
    const response = await request.get(path)
    expect(response.status(), `${path} status`).toBe(200)
    expect(await response.text(), `${path} root element`).toContain(`<${root}`)
  }
})

test('private surfaces are excluded from search indexes', async ({ request }) => {
  for (const path of ['/admin', '/account', '/auth/sign-in']) {
    const response = await request.get(path)
    expect(response.headers()['x-robots-tag'], `${path} X-Robots-Tag`).toContain('noindex')
  }
})

test('unknown routes return the branded 404', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist-live-smoke')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'पृष्ठ नहीं मिला' })).toBeVisible()
})

test('the deployed build is not a development build', async ({ request }) => {
  const response = await request.get('/')
  const csp = response.headers()['content-security-policy'] ?? ''
  expect(csp, 'CSP header missing').not.toBe('')
  // next.config.ts only adds 'unsafe-eval' when NODE_ENV === 'development'.
  expect(csp, "CSP contains 'unsafe-eval' — a dev build reached this URL").not.toContain(
    "'unsafe-eval'",
  )
})
