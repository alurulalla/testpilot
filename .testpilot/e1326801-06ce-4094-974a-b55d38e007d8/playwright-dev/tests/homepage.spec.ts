import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Playwright Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('main heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1 }).first()
    ).toBeVisible();
  });

  test('navigation links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MCP', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'CLI', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'API' })).toBeVisible();
  });

  test('Playwright logo link navigates to home', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: /Playwright/i }).first();
    await expect(logoLink).toBeVisible();
    await logoLink.click();
    await expect(page).toHaveURL(TARGET_URL);
  });

  test('Get started button is visible and links to docs', async ({ page }) => {
    const getStartedLink = page.getByRole('link', { name: 'Get started' });
    await expect(getStartedLink).toBeVisible();
    await expect(getStartedLink).toHaveAttribute('href', '/docs/intro');
  });

  test('GitHub Star link is visible', async ({ page }) => {
    const starLink = page.getByRole('link', { name: /Star microsoft\/playwright on GitHub/i });
    await expect(starLink).toBeVisible();
  });

  test('GitHub stargazers count link is visible', async ({ page }) => {
    const stargazersLink = page.getByRole('link', { name: /k\+/i }).filter({ hasText: /\d+k\+/i });
    await expect(stargazersLink).toBeVisible();
  });

  test('language links are visible in banner', async ({ page }) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'TypeScript' })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Python' }).first()).toBeVisible();
    await expect(banner.getByRole('link', { name: '.NET' }).first()).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Java' }).first()).toBeVisible();
  });

  test('Playwright Test section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Playwright Test', level: 3 })).toBeVisible();
    await expect(page.getByText('npm init playwright@latest')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Testing documentation' })).toBeVisible();
  });

  test('Playwright CLI section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Playwright CLI', level: 3 })).toBeVisible();
    await expect(page.getByText('npm i -g @playwright/cli@latest')).toBeVisible();
    await expect(page.getByRole('link', { name: 'CLI documentation' })).toBeVisible();
  });

  test('Playwright MCP section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Playwright MCP', level: 3 })).toBeVisible();
    await expect(page.getByText('npx @playwright/mcp@latest')).toBeVisible();
    await expect(page.getByRole('link', { name: 'MCP documentation' })).toBeVisible();
  });

  test('Built for testing heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Built for testing', level: 2 })).toBeVisible();
  });

  test('Auto-wait and web-first assertions section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Auto-wait and web-first assertions', level: 4 })
    ).toBeVisible();
  });

  test('Test isolation section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Test isolation', level: 4 })).toBeVisible();
  });

  test('Node.js button is visible in navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Node.js' })).toBeVisible();
  });

  test('Search button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Search/i })).toBeVisible();
  });

  test('GitHub repository link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'GitHub repository' })).toBeVisible();
  });

  test('Discord server link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Discord server' })).toBeVisible();
  });

  test('dark/light mode toggle is visible', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Switch between dark and light mode/i })
    ).toBeVisible();
  });

  test('clicking Docs nav link navigates to docs intro', async ({ page }) => {
    await page.getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/intro/);
  });

  test('clicking Testing documentation link navigates to docs', async ({ page }) => {
    await page.getByRole('link', { name: 'Testing documentation' }).click();
    await expect(page).toHaveURL(/\/docs\/intro/);
  });

  test('clicking CLI documentation link navigates to CLI docs', async ({ page }) => {
    await page.getByRole('link', { name: 'CLI documentation' }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started-cli/);
  });

  test('clicking MCP documentation link navigates to MCP docs', async ({ page }) => {
    await page.getByRole('link', { name: 'MCP documentation' }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started-mcp/);
  });

  test('one API description text is visible', async ({ page }) => {
    await expect(
      page.getByText(/One API to drive Chromium, Firefox, and WebKit/i)
    ).toBeVisible();
  });

  test('skip to main content link exists', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });
});