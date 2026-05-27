import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test('user clicks on Microsoft Privacy Statement link', async ({ page }) => {
  await page.goto(TARGET_URL)

  const privacyLink = page.getByRole('link', { name: /microsoft privacy statement/i })
  await expect(privacyLink).toBeVisible()
  await privacyLink.click()

  await expect(page).toHaveURL(/privacy\.microsoft\.com/i)
})