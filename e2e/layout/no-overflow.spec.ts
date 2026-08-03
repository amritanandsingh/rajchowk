import { expect, test } from '@playwright/test'

const routes = ['/', '/latest', '/janmat', '/ask', '/promises', '/live', '/search', '/auth/sign-up']

for (const width of [320, 360, 414, 768, 1280]) {
  test(`public routes do not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const path of routes) {
      await page.goto(path)
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(dimensions.scroll, `${path} at ${width}px`).toBeLessThanOrEqual(dimensions.client)
    }
  })
}
