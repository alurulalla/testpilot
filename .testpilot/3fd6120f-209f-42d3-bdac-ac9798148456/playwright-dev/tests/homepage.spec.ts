import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Playwright Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Fast and reliable end-to-end testing for modern web apps | Playwright/);
  });

  test('main heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1 })
    ).toContainText('Playwright enables reliable web automation');
  });

  test('navigation bar is present with key links', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    await expect(nav.getByRole('link', { name: /Playwright/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'MCP' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'CLI' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'API' })).toBeVisible();
  });

  test('Node.js button is visible in navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Node.js' })).toBeVisible();
  });

  test('search button is visible in navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Search/i })).toBeVisible();
  });

  test('GitHub repository link is present', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: 'GitHub repository' })
    ).toBeVisible();
  });

  test('Discord server link is present', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: 'Discord server' })
    ).toBeVisible();
  });

  test('Get started link is visible in hero banner', async ({ page }) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'Get started' })).toBeVisible();
  });

  test('Star link points to GitHub', async ({ page }) => {
    const starLink = page.getByRole('link', { name: 'Star microsoft/playwright on GitHub' });
    await expect(starLink).toBeVisible();
    await expect(starLink).toHaveAttribute('href', 'https://github.com/microsoft/playwright');
  });

  test('GitHub stargazers link is visible', async ({ page }) => {
    const stargazersLink = page.getByRole('link', { name: /89k\+/i });
    await expect(stargazersLink).toBeVisible();
    await expect(stargazersLink).toHaveAttribute('href', 'https://github.com/microsoft/playwright/stargazers');
  });

  test('language links are present in hero section', async ({ page }) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'TypeScript' })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Python' }).first()).toBeVisible();
    await expect(banner.getByRole('link', { name: '.NET' }).first()).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Java' }).first()).toBeVisible();
  });

  test('Playwright Test section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Playwright Test', level: 3 })
    ).toBeVisible();
    await expect(page.getByText('Full-featured test runner with auto-waiting')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Testing documentation' })).toBeVisible();
  });

  test('Playwright CLI section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Playwright CLI', level: 3 })
    ).toBeVisible();
    await expect(page.getByText('Token-efficient browser automation for coding agents')).toBeVisible();
    await expect(page.getByRole('link', { name: 'CLI documentation' })).toBeVisible();
  });

  test('Playwright MCP section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Playwright MCP', level: 3 })
    ).toBeVisible();
    await expect(page.getByText('Model Context Protocol server that gives AI agents')).toBeVisible();
    await expect(page.getByRole('link', { name: 'MCP documentation' })).toBeVisible();
  });

  test('Built for testing heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Built for testing', level: 2 })
    ).toBeVisible();
  });

  test('Auto-wait and web-first assertions section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Auto-wait and web-first assertions', level: 4 })
    ).toBeVisible();
    await expect(
      page.getByText('Playwright waits for elements to be actionable')
    ).toBeVisible();
  });

  test('Test isolation section is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Test isolation', level: 4 })
    ).toBeVisible();
    await expect(
      page.getByText('Each test gets a fresh browser context')
    ).toBeVisible();
  });

  test('npm init playwright code snippet is visible', async ({ page }) => {
    await expect(page.getByText('npm init playwright@latest')).toBeVisible();
  });

  test('npm install playwright CLI code snippet is visible', async ({ page }) => {
    await expect(page.getByText('npm i -g @playwright/cli@latest')).toBeVisible();
  });

  test('MCP code snippet is visible', async ({ page }) => {
    await expect(page.getByText('npx @playwright/mcp@latest')).toBeVisible();
  });

  test('clicking Docs nav link navigates to intro page', async ({ page }) => {
    const docsLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' });
    await docsLink.click();
    await expect(page).toHaveURL(/\/docs\/intro/);
  });

  test('clicking Get started navigates to intro page', async ({ page }) => {
    const getStartedLink = page.getByRole('banner').getByRole('link', { name: 'Get started' });
    await getStartedLink.click();
    await expect(page).toHaveURL(/\/docs\/intro/);
  });

  test('clicking Testing documentation link navigates correctly', async ({ page }) => {
    const testingDocsLink = page.getByRole('link', { name: 'Testing documentation' });
    await testingDocsLink.click();
    await expect(page).toHaveURL(/\/docs\/intro/);
  });

  test('theme toggle button is present', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Switch between dark and light mode/i })
    ).toBeVisible();
  });

  test('Playwright logo link points to home', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: /Playwright logo Playwright/i });
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute('href', '/');
  });

  test('skip to main content link is present', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });
});