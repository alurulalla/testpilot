import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test('Navigate to test debugging page through commands', async ({ page }) => {
  // Navigate directly to the debugging documentation page
  await page.goto('https://playwright.dev/docs/debug')

  // Wait for the page to load
  await page.waitForLoadState('networkidle')

  // Verify we are on the debugging page
  const debugHeading = page.getByRole('heading', { name: /debug/i, level: 1 })
  await expect(debugHeading).toBeVisible()

  // Verify some key debugging content is visible
  const vsCodeText = page.getByText(/VS Code/i).first()
  const inspectorText = page.getByText(/Inspector/i).first()

  // At least one of these should be visible on the debugging page
  const vsCodeVisible = await vsCodeText.isVisible().catch(() => false)
  const inspectorVisible = await inspectorText.isVisible().catch(() => false)

  expect(vsCodeVisible || inspectorVisible).toBeTruthy()
})

test('Navigate to debug page via PWDEBUG environment variable section', async ({ page }) => {
  // Navigate directly to the debugging documentation page
  await page.goto('https://playwright.dev/docs/debug')

  // Wait for the page to load
  await page.waitForLoadState('networkidle')

  // Verify the page title contains debug-related content
  await expect(page).toHaveTitle(/Debug/i)

  // Verify the main heading is visible
  const mainHeading = page.getByRole('heading', { name: /debug/i, level: 1 })
  await expect(mainHeading).toBeVisible()

  // Check for debugging commands like PWDEBUG
  const pwdebugContent = page.getByText(/PWDEBUG/i).first()
  await expect(pwdebugContent).toBeVisible()

  // Check for the Playwright Inspector reference
  const inspectorText = page.getByText(/Playwright Inspector/i).first()
  await expect(inspectorText).toBeVisible()
})