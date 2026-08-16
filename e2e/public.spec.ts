import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The public surface, against an UNREACHABLE backend.
 *
 * See playwright.config.ts: the server runs on the placeholder outputs, so
 * every AppSync call fails instantly. Everything below therefore tests the
 * degraded path, which is the one that matters — a feed that looks fine when
 * the API works and shows a stack trace when it does not has not met the
 * requirement.
 */

test.describe('public feed', () => {
  test('renders without an account, and never blank', async ({ page }) => {
    await page.goto('/')

    // The masthead proves the page rendered rather than 500ing.
    await expect(page.getByRole('banner')).toContainText('राज चौक')

    // With no reachable API the feed is empty — and says so, in words, rather
    // than rendering nothing.
    await expect(page.getByRole('status')).toContainText('अभी कोई लेख प्रकाशित नहीं हुआ है')
  })

  test('sets no cookies and requires no sign-in', async ({ page, context }) => {
    await page.goto('/')

    // A reader is anonymous. Any cookie here would mean the public page had
    // touched the Cognito session machinery, which it must not.
    const cookies = await context.cookies()
    expect(cookies.filter((cookie) => cookie.name.includes('CognitoIdentity'))).toHaveLength(0)
  })

  test('carries the security headers', async ({ page }) => {
    const response = await page.goto('/')
    const headers = response?.headers() ?? {}

    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['content-security-policy']).toContain("object-src 'none'")
    // The article image CDN. Without this every published image is blocked,
    // and it fails silently in the console rather than breaking a build — so
    // it is pinned here where a CSP edit will trip over it.
    expect(headers['content-security-policy']).toContain('img-src')
    expect(headers['content-security-policy']).toContain('https://*.cloudfront.net')
    // Next advertises its own presence by default; a version number is free
    // reconnaissance.
    expect(headers['x-powered-by']).toBeUndefined()
  })

  test('a missing article renders the not-found page with chrome intact', async ({ page }) => {
    await page.goto('/article/does-not-exist')

    await expect(page.getByText('पृष्ठ नहीं मिला')).toBeVisible()
    // The root not-found sits outside the (public) route group and renders its
    // own header — without it this looks like a broken deployment.
    await expect(page.getByRole('banner')).toBeVisible()
  })

  test('a missing article is marked noindex', async ({ page }) => {
    await page.goto('/article/does-not-exist')

    /**
     * This asserts the SOFT-404 MITIGATION.
     *
     * On Next.js 15.5.22 `notFound()` responds HTTP 200 rather than 404
     * (reproduced against a minimal next.config.ts and Next's own default
     * not-found page, so it is framework behaviour). A crawler therefore sees
     * a success for any unknown slug, and only the robots directive stops an
     * unlimited number of garbage URLs being indexed.
     *
     * The 404 status assertion this replaces is deliberately absent rather
     * than skipped: asserting it would fail for a reason this codebase cannot
     * fix, and dropping the check entirely would let the mitigation be deleted
     * unnoticed.
     *
     * TWO tags are expected — Next emits its own `noindex` for `notFound()`,
     * and generateMetadata adds `noindex, nofollow`. They agree, so there is
     * no conflicting directive; asserting EVERY tag is noindex is what would
     * catch a future change that made them disagree.
     */
    const robots = page.locator('meta[name="robots"]')
    const count = await robots.count()
    expect(count).toBeGreaterThan(0)

    const directives = await robots.evaluateAll((tags) =>
      tags.map((tag) => tag.getAttribute('content') ?? ''),
    )
    for (const directive of directives) {
      expect(directive).toMatch(/noindex/)
    }
  })

  test('a REAL 404 route still returns the 404 status', async ({ page }) => {
    // Next's own routing-level 404 is unaffected by the above — only
    // `notFound()` called from inside a page is.
    const response = await page.goto('/definitely-not-a-route')
    expect(response?.status()).toBe(404)
  })

  test('the skip link moves focus, not just the scroll position', async ({ page }) => {
    await page.goto('/')

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'मुख्य सामग्री पर जाएँ' })
    await expect(skipLink).toBeFocused()

    await page.keyboard.press('Enter')
    // The classic broken skip link scrolls but leaves focus in the header.
    // `tabIndex={-1}` on the Container target is what makes this pass.
    await expect(page.locator('#content')).toBeFocused()
  })

  test('does not overflow horizontally', async ({ page }) => {
    await page.goto('/')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

test.describe('search', () => {
  test('the feed offers a search box that needs no JavaScript', async ({ page }) => {
    await page.goto('/')

    const search = page.getByRole('search')
    await expect(search).toBeVisible()
    // A GET form is the whole mechanism: the URL is the state, so a result
    // page is shareable and works before hydration. A POST or an onSubmit
    // handler here would end all three properties.
    await expect(search).toHaveAttribute('method', 'get')
    await expect(page.getByRole('searchbox', { name: 'लेख खोजें' })).toBeVisible()
  })

  test('submitting puts the term in the URL', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('searchbox', { name: 'लेख खोजें' }).fill('चुनाव')
    await page.getByRole('button', { name: 'खोजें' }).click()

    await expect(page).toHaveURL(/\?q=/)
    // The term survives the round trip, so a second search does not start from
    // an empty field.
    await expect(page.getByRole('searchbox', { name: 'लेख खोजें' })).toHaveValue('चुनाव')
  })

  test('a search with no matches says so, and does not claim the site is empty', async ({
    page,
  }) => {
    // With no reachable API the search degrades to zero results. The copy must
    // still be the search copy: telling a reader "nothing has been published"
    // is a different and false claim.
    await page.goto('/?q=चुनाव')

    await expect(page.getByRole('status')).toContainText('कोई लेख नहीं मिला')
    await expect(page.getByRole('status')).not.toContainText('अभी कोई लेख प्रकाशित नहीं हुआ है')
  })

  test('offers a way back to the full feed from a search', async ({ page }) => {
    await page.goto('/?q=चुनाव')
    await page.getByRole('link', { name: 'खोज हटाएँ' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('status')).toContainText('अभी कोई लेख प्रकाशित नहीं हुआ है')
  })

  test('a search page does not overflow horizontally', async ({ page }) => {
    // The input and its button sit in a flex row; a flex item's default
    // min-width is auto, not 0, which is how this overflows on a 412px screen.
    await page.goto('/?q=' + encodeURIComponent('क'.repeat(80)))

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })

  test('has no detectable accessibility violations while searching', async ({ page }) => {
    await page.goto('/?q=चुनाव')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

test.describe('about', () => {
  test('renders the publication’s purpose with the chrome intact', async ({ page }) => {
    await page.goto('/about')

    await expect(page.getByRole('heading', { level: 1, name: 'परिचय' })).toBeVisible()
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('contentinfo')).toBeVisible()
  })

  test('needs no backend, so it renders even when AppSync is unreachable', async ({ page }) => {
    // Static copy. If this ever starts failing, something gave the page a data
    // dependency it should not have.
    const response = await page.goto('/about')
    expect(response?.status()).toBe(200)
  })

  test('is reachable from the masthead on every page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'परिचय' }).click()

    await expect(page).toHaveURL(/\/about$/)
  })

  test('links back to the feed', async ({ page }) => {
    await page.goto('/about')
    await page.getByRole('link', { name: /सभी लेख/ }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('does not overflow horizontally', async ({ page }) => {
    await page.goto('/about')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/about')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

test.describe('robots and sitemap', () => {
  test('robots.txt disallows /admin and points at the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt')
    const body = await response.text()

    expect(body).toContain('Disallow: /admin')
    expect(body).toContain('/sitemap.xml')
  })

  test('sitemap.xml is well-formed even with no articles', async ({ request }) => {
    const response = await request.get('/sitemap.xml')

    expect(response.headers()['content-type']).toContain('xml')
    const body = await response.text()
    expect(body).toContain('<urlset')
    // The homepage is always present; article URLs are added as they publish.
    expect(body).toContain('<loc>')
  })

  test('sitemap.xml lists /about but never a search result', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text()

    expect(body).toContain('/about')
    // `?q=` is an unbounded URL space built from user input. Listing it invites
    // a crawler to index a different page for every word in the language.
    expect(body).not.toContain('?q=')
  })
})
