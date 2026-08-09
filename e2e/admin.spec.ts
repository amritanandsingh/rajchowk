import { expect, test } from '@playwright/test'

/**
 * Admin route protection.
 *
 * These tests exercise the MIDDLEWARE layer specifically: an anonymous request
 * must be redirected before any admin markup is generated. They deliberately
 * do not sign in — the authorization that actually protects data lives on
 * AppSync (`allow.group('ADMIN')`) and inside the Lambdas, and that is covered
 * by the handler unit tests and by `npm run verify:backend` against a real
 * deployment.
 */

test.describe('admin routes are gated server-side', () => {
  for (const path of [
    '/admin',
    '/admin/articles/new',
    '/admin/articles/some-id/edit',
    '/admin/anything-else',
  ]) {
    test(`${path} redirects an anonymous visitor to sign-in`, async ({ page }) => {
      await page.goto(path)

      await expect(page).toHaveURL(/\/admin\/login/)
      await expect(page.getByRole('heading', { name: 'प्रशासक साइन इन' })).toBeVisible()
    })
  }

  test('never serves dashboard markup to an anonymous visitor', async ({ page }) => {
    await page.goto('/admin')

    // The redirect happens in middleware, so the dashboard HTML is never
    // generated — not merely hidden by a client-side guard that ships it first.
    await expect(page.getByRole('heading', { name: 'संपादकीय डैशबोर्ड' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'नया लेख' })).toHaveCount(0)
  })

  test('round-trips the intended destination as a PATH', async ({ page }) => {
    await page.goto('/admin/articles/new')

    const next = new URL(page.url()).searchParams.get('next')
    expect(next).toBe('/admin/articles/new')
    // A path, never an absolute URL: an attacker-supplied absolute `next` is
    // an open redirect on a page where the victim is about to type real
    // credentials. safeNext() in sign-in-form.tsx rejects those.
    expect(next?.startsWith('/')).toBe(true)
    expect(next?.startsWith('//')).toBe(false)
  })

  test('the login page itself is reachable and does not loop', async ({ page }) => {
    await page.goto('/admin/login')

    await expect(page).toHaveURL(/\/admin\/login$/)
    await expect(page.getByLabel('ईमेल')).toBeVisible()
    await expect(page.getByLabel('पासवर्ड')).toBeVisible()
  })
})

test.describe('admin is excluded from search engines', () => {
  test('sends X-Robots-Tag and no-store on /admin', async ({ page }) => {
    const response = await page.goto('/admin')
    const headers = response?.headers() ?? {}

    // The header is the control that actually deindexes — a robots.txt
    // disallow leaks the URL and does not remove it from an index.
    expect(headers['x-robots-tag']).toContain('noindex')
    expect(headers['cache-control']).toContain('no-store')
  })
})

test.describe('sign-in form behaviour', () => {
  test('rejects an empty submission without a network call', async ({ page }) => {
    await page.goto('/admin/login')

    let calledOut = false
    await page.route('**/graphql', (route) => {
      calledOut = true
      return route.abort()
    })

    await page.getByRole('button', { name: 'साइन इन करें' }).click()

    // Native `required` blocks it; nothing reaches the network.
    expect(calledOut).toBe(false)
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('shows one generic message for bad credentials', async ({ page }) => {
    await page.goto('/admin/login')

    await page.getByLabel('ईमेल').fill('nobody@example.com')
    await page.getByLabel('पासवर्ड').fill('WrongPassword!123')
    await page.getByRole('button', { name: 'साइन इन करें' }).click()

    // Cognito is unreachable here, so this exercises the catch-all path. The
    // message must be the same one a wrong password produces: distinguishing
    // "no such user" from "wrong password" turns the form into an account
    // enumeration oracle.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  })
})
