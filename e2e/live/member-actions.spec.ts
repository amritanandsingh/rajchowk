import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  createUser,
  deleteUser,
  PASSWORD,
  type TestUser,
} from '../../tests/integration/harness/users'

/**
 * The ONLY proof that the RC-1 fix actually works.
 *
 * Every other layer is blind to it. tests/integration/ cannot use
 * `authMode: 'userPool'` at all — harness/clients.ts documents that it throws
 * `NoValidAuthTokens: No federated jwt` in Node, so it passes a raw JWT with
 * `authMode: 'none'`. That exercises the authorization RULES but never
 * `generateClient({ authMode: 'userPool' })`, which is the exact line the fix
 * changed. Component tests mock the client away entirely.
 *
 * So: a real browser, a real Cognito sign-in, a real user-pool-signed request.
 * `vote.test.ts` passed for months while castVote was broken in the browser —
 * this is the layer that would have caught that.
 *
 * Point this at a SANDBOX, never production: it signs in a real user and writes
 * rows. Run with:
 *   npm run build
 *   E2E_LIVE=1 E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:3000 npm run e2e:live
 *
 * A production build matters — `next dev` relaxes the CSP with 'unsafe-eval',
 * so a dev run cannot catch a CSP regression that would break Amplify's client.
 */

let member: TestUser

test.beforeAll(async () => {
  // Pre-confirmed with a permanent password, so the real SRP sign-in works with
  // no email step. Same helper the integration suite uses.
  member = await createUser('MEMBER', `e2e${randomUUID().slice(0, 6)}`)
})

test.afterAll(async () => {
  await deleteUser(member.username)
})

/** Sign in through the real UI and land on /account. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/sign-in')
  await page.getByLabel('ईमेल').fill(member.username)
  await page.getByLabel('पासवर्ड').fill(PASSWORD)
  await page.getByRole('button', { name: 'साइन इन' }).click()

  // Landing on /account is a stronger assertion than it looks. auth-form.tsx
  // calls ensureUserProfile after a successful sign-in and DELIBERATELY blocks
  // navigation if it fails, showing the error instead — so arriving here proves
  // the profile write succeeded over a user-pool-signed request.
  await expect(page).toHaveURL(/\/account/, { timeout: 20_000 })
}

test('a signed-out visitor cannot submit a question', async ({ page }) => {
  // Negative control. The form is not auth-gated, so if this ever "succeeds" the
  // positive test below proves nothing.
  await page.goto('/ask')
  await page.getByRole('textbox').first().fill('यह बिना साइन-इन वाला परीक्षण सवाल है।')
  await page.getByRole('button', { name: 'सवाल पूछें' }).click()

  const status = page.getByRole('status')
  await expect(status).toBeVisible({ timeout: 20_000 })
  await expect(status).not.toHaveText('आपका सवाल समीक्षा के लिए भेज दिया गया है')
})

test('a signed-in member can submit a question', async ({ page }) => {
  // THE REGRESSION TEST FOR ISSUE #7, end to end through the browser.
  //
  // Before the fix this failed twice over: the form signed through the identity
  // pool so AppSync answered Unauthorized, and even past that the member had no
  // UserProfile so the Lambda answered FORBIDDEN.
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  })

  await signIn(page)

  await page.goto('/ask')
  await page.getByRole('textbox').first().fill('यह ब्राउज़र से भेजा गया परीक्षण सवाल है।')
  await page.getByRole('button', { name: 'सवाल पूछें' }).click()

  await expect(page.getByRole('status')).toHaveText('आपका सवाल समीक्षा के लिए भेज दिया गया है', {
    timeout: 20_000,
  })

  // The specific failure mode being guarded. Amplify resolves { data, errors }
  // rather than throwing, so an authorization failure surfaces as text, not a
  // crash — asserting on the success string alone could mask a changed message.
  const authFailures = problems.filter((entry) => /unauthorized|not authorized/i.test(entry))
  expect(authFailures, `authorization errors in the browser:\n${authFailures.join('\n')}`).toEqual(
    [],
  )
})
