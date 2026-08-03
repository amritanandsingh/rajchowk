import { expect, test } from '@playwright/test'

test('mobile navigation reaches the primary public sections', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'राज चौक', exact: true })).toBeVisible()
  const menu = page.getByRole('button', { name: 'मेन्यू' })
  await menu.click()
  const navigation = page.getByRole('navigation', { name: 'मुख्य नेविगेशन' })
  await expect(navigation).toBeVisible()
  await navigation.getByRole('link', { name: 'ताज़ा', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ताज़ा', exact: true })).toBeVisible()
})

test('all public landing pages render a meaningful heading', async ({ page }) => {
  const routes = [
    ['/opinion', 'मेरी राय'],
    ['/janmat', 'जनमत'],
    ['/ask', 'अमृत से पूछें'],
    ['/promises', 'वादा ट्रैकर'],
    ['/live', 'लाइव चर्चा'],
    ['/videos', 'वीडियो'],
    ['/about', 'हमारे बारे में'],
    ['/search', 'खोज'],
  ] as const
  for (const [path, heading] of routes) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
  }
})

test('account authentication screens expose complete labeled forms', async ({ page }) => {
  await page.goto('/auth/sign-up')
  await expect(page.getByLabel('नाम')).toBeVisible()
  await expect(page.getByLabel('ईमेल')).toBeVisible()
  await expect(page.getByLabel('पासवर्ड')).toBeVisible()
  await expect(page.getByRole('button', { name: 'खाता बनाएँ' })).toBeVisible()

  await page.goto('/auth/sign-in')
  await expect(page.getByRole('heading', { name: 'साइन इन' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'खाता बनाएँ' })).toBeVisible()
})

test('unknown routes use the branded not-found page', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'पृष्ठ नहीं मिला' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'होम पर जाएँ' })).toBeVisible()
})
