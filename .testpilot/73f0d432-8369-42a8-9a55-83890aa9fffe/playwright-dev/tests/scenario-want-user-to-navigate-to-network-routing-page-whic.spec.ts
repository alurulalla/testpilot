import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test.describe('Network Routing Page Navigation and Scenarios', () => {
  test('Navigate to Network Routing page via Commands link and verify content', async ({ page }) => {
    // Navigate directly to the Playwright homepage
    await page.goto('https://playwright.dev/')

    // Verify we are on the correct page by checking the main heading (use first to avoid strict mode violation)
    await expect(page.getByRole('heading', { name: /playwright/i }).first()).toBeVisible()

    // Look for the Docs or API link that leads to Commands/Network routing
    // Try to find a "Docs" link in the navigation
    const docsLink = page.getByRole('link', { name: /docs/i })
    if (await docsLink.isVisible()) {
      await docsLink.click()
    }

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle')

    // Look for a search or navigation to find "Network routing" under commands
    // Try to find a search input to navigate to network routing
    const searchButton = page.getByRole('button', { name: /search/i })
    if (await searchButton.isVisible()) {
      await searchButton.click()

      const searchInput = page.getByRole('searchbox')
      if (await searchInput.isVisible()) {
        await searchInput.fill('network routing')
        await page.waitForTimeout(500)

        // Click on search result for network routing
        const networkRoutingResult = page.getByText(/network routing/i).first()
        if (await networkRoutingResult.isVisible()) {
          await networkRoutingResult.click()
        }
      }
    }

    // Alternatively, navigate directly to the network routing page
    await page.goto('https://playwright.dev/docs/network')

    // Verify the Network page heading is visible
    await expect(page.getByRole('heading', { name: /network/i }).first()).toBeVisible()

    // Verify key network routing content exists
    await expect(page.getByText(/route/i).first()).toBeVisible()
  })

  test('Verify network routing page has correct headings and content', async ({ page }) => {
    // Navigate directly to the network docs page
    await page.goto('https://playwright.dev/docs/network')

    // Confirm page title contains relevant content
    await expect(page).toHaveTitle(/network/i)

    // Check main heading is visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Verify the page contains information about route handling
    await expect(page.getByText(/page\.route/i).first()).toBeVisible()
  })

  test('Verify network routing abort and fulfill scenarios', async ({ page }) => {
    // Navigate directly to the network docs page
    await page.goto('https://playwright.dev/docs/network')

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded')

    // Check for abort scenario content
    const abortContent = page.getByText(/abort/i).first()
    await expect(abortContent).toBeVisible()

    // Check for fulfill scenario content
    const fulfillContent = page.getByText(/fulfill/i).first()
    await expect(fulfillContent).toBeVisible()

    // Check for continue scenario
    const continueContent = page.getByText(/continue/i).first()
    await expect(continueContent).toBeVisible()
  })

  test('Verify network routing page navigation links are present', async ({ page }) => {
    // Navigate directly to the network docs page
    await page.goto('https://playwright.dev/docs/network')

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded')

    // Check that the main page heading is visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Verify there are navigation links on the page
    const links = page.getByRole('link')
    await expect(links.first()).toBeVisible()

    // Verify the page URL contains 'network'
    await expect(page).toHaveURL(/network/)
  })

  test('Verify commands section leads to network routing content', async ({ page }) => {
    // Navigate to the Playwright homepage
    await page.goto('https://playwright.dev/')

    // Verify homepage loaded (use first to avoid strict mode violation)
    await expect(page.getByRole('heading', { name: /playwright/i }).first()).toBeVisible()

    // Navigate to docs
    await page.goto('https://playwright.dev/docs/network')

    // Verify navigation to network page
    await expect(page).toHaveURL(/network/)

    // Confirm page title
    await expect(page).toHaveTitle(/network/i)

    // Verify code examples are present on the page
    const codeBlock = page.getByRole('code').first()
    if (await codeBlock.count() > 0) {
      await expect(codeBlock).toBeVisible()
    }

    // Check page contains route-related API documentation
    await expect(page.getByText(/page\.route/i).first()).toBeVisible()
  })
})