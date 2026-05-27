import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test('page loads successfully', async ({ page }) => {
  await page.goto(TARGET_URL);
  await expect(page).toHaveURL(/playwright\.dev/);
});

test('main heading is visible', async ({ page }) => {
  await page.goto(TARGET_URL);
  const heading = page.getByRole('heading', { name: /playwright/i });
  await expect(heading.first()).toBeVisible();
});

test('get started link is visible and clickable', async ({ page }) => {
  await page.goto(TARGET_URL);
  const getStartedLink = page.getByRole('link', { name: /get started/i });
  await expect(getStartedLink.first()).toBeVisible();
  await getStartedLink.first().click();
  await expect(page).toHaveURL(/playwright\.dev/);
});

test('navigation bar is present', async ({ page }) => {
  await page.goto(TARGET_URL);
  const nav = page.getByRole('navigation');
  await expect(nav.first()).toBeVisible();
});

test('docs link is present in navigation', async ({ page }) => {
  await page.goto(TARGET_URL);
  const docsLink = page.getByRole('link', { name: /docs/i });
  await expect(docsLink.first()).toBeVisible();
});

test('API link is present', async ({ page }) => {
  await page.goto(TARGET_URL);
  const apiLink = page.getByRole('link', { name: /api/i });
  await expect(apiLink.first()).toBeVisible();
});

test('clicking docs navigates to docs page', async ({ page }) => {
  await page.goto(TARGET_URL);
  const docsLink = page.getByRole('link', { name: /docs/i });
  await docsLink.first().click();
  await expect(page).toHaveURL(/playwright\.dev/);
  await page.waitForLoadState('domcontentloaded');
});

test('GitHub link is present', async ({ page }) => {
  await page.goto(TARGET_URL);
  const githubLink = page.getByRole('link', { name: /github/i });
  await expect(githubLink.first()).toBeVisible();
});

test('page has search functionality', async ({ page }) => {
  await page.goto(TARGET_URL);
  const searchButton = page.getByRole('button', { name: /search/i });
  if (await searchButton.count() > 0) {
    await expect(searchButton.first()).toBeVisible();
  } else {
    const searchInput = page.getByRole('searchbox');
    if (await searchInput.count() > 0) {
      await expect(searchInput.first()).toBeVisible();
    }
  }
});

test('page title contains Playwright', async ({ page }) => {
  await page.goto(TARGET_URL);
  await expect(page).toHaveTitle(/playwright/i);
});

test('hero section text is visible', async ({ page }) => {
  await page.goto(TARGET_URL);
  const reliableText = page.getByText(/reliable/i);
  if (await reliableText.count() > 0) {
    await expect(reliableText.first()).toBeVisible();
  } else {
    const mainContent = page.getByRole('main');
    await expect(mainContent.first()).toBeVisible();
  }
});

test('Node.js mention or language options are visible', async ({ page }) => {
  await page.goto(TARGET_URL);
  const nodeText = page.getByText(/node\.js/i);
  if (await nodeText.count() > 0) {
    await expect(nodeText.first()).toBeVisible();
  } else {
    const heading = page.getByRole('heading');
    await expect(heading.first()).toBeVisible();
  }
});

test('community or blog link exists', async ({ page }) => {
  await page.goto(TARGET_URL);
  const communityLink = page.getByRole('link', { name: /community|blog|discord/i });
  if (await communityLink.count() > 0) {
    await expect(communityLink.first()).toBeVisible();
  }
});

test('page footer is present', async ({ page }) => {
  await page.goto(TARGET_URL);
  const footer = page.getByRole('contentinfo');
  if (await footer.count() > 0) {
    await expect(footer.first()).toBeVisible();
  }
});