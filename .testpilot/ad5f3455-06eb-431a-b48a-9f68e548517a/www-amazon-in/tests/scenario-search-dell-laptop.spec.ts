import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test('search dell laptop on amazon.in', async ({ page }) => {
  // Navigate directly to the target URL
  await page.goto('https://www.amazon.in/')

  // Confirm we landed on the right page
  await expect(page).toHaveTitle(/Amazon\.in/)

  // Find the search input and type 'dell laptop'
  const searchBox = page.getByRole('searchbox', { name: /search/i })
  await expect(searchBox).toBeVisible()
  await searchBox.click()
  await searchBox.fill('dell laptop')

  // Submit the search using the specific submit button by id
  const searchButton = page.locator('#nav-search-submit-button')
  await searchButton.click()

  // Wait for search results page to load
  await page.waitForLoadState('domcontentloaded')

  // Verify search results are displayed for dell laptop
  await expect(page).toHaveURL(/s\?.*dell.*laptop|s\?.*k=dell\+laptop/i)

  // Verify some results appear on the page
  const results = page.getByRole('listitem').filter({ hasText: /dell/i })
  await expect(results.first()).toBeVisible({ timeout: 10000 })
})