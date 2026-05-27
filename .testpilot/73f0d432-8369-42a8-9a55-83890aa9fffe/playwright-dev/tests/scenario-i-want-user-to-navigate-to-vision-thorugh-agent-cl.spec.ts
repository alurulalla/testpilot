import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test('Navigate to Vision through Agent CLI', async ({ page }) => {
  // Navigate directly to the Playwright homepage
  await page.goto('https://playwright.dev/')

  // Confirm we landed on the right page
  await expect(page).toHaveTitle(/Playwright/)

  // Verify the main heading is visible
  const mainHeading = page.getByRole('heading', { name: /Playwright enables reliable/i })
  await expect(mainHeading).toBeVisible()

  // Look for a navigation link related to "Docs" or top-level nav
  const docsLink = page.getByRole('link', { name: /Docs/i })
  await expect(docsLink).toBeVisible()
  await docsLink.click()

  // Wait for navigation to complete
  await page.waitForLoadState('networkidle')

  // Look for Agent CLI related content in the navigation or page
  // Try to find "CLI" in the sidebar or navigation
  const cliLink = page.getByRole('link', { name: /CLI/i }).first()
  if (await cliLink.isVisible()) {
    await cliLink.click()
    await page.waitForLoadState('networkidle')
  }

  // Search for Vision related content via Agent CLI
  // Look for search functionality to find "Vision" through Agent CLI
  const searchButton = page.getByRole('button', { name: /Search/i })
  if (await searchButton.isVisible()) {
    await searchButton.click()

    // Type in search query for Agent CLI Vision
    const searchInput = page.getByRole('searchbox')
    if (await searchInput.isVisible()) {
      await searchInput.fill('Agent CLI Vision')
      await page.waitForTimeout(1000)

      // Look for Vision result in search results
      const visionResult = page.getByRole('option', { name: /Vision/i }).first()
      if (await visionResult.isVisible()) {
        await visionResult.click()
        await page.waitForLoadState('networkidle')

        // Confirm Vision page content is visible
        const visionHeading = page.getByRole('heading', { name: /Vision/i })
        await expect(visionHeading).toBeVisible()
      }
    }
  } else {
    // Navigate directly to the Agent CLI page and look for vision section
    await page.goto('https://playwright.dev/docs/test-cli')
    await page.waitForLoadState('networkidle')

    // Check for Vision related heading or text on the page
    const visionText = page.getByText(/Vision/i).first()
    await expect(visionText).toBeVisible()
  }

  // Final assertion: ensure we are on a page that mentions Vision
  const pageContent = await page.content()
  expect(pageContent.toLowerCase()).toContain('vision')
})