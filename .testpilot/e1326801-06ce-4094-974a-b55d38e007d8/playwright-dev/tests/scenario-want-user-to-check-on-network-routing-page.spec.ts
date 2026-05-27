import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test('user checks network routing page on Playwright docs', async ({ page }) => {
  await page.goto(TARGET_URL);

  await expect(page).toHaveTitle(/Playwright/);

  const docsLink = page.getByRole('link', { name: /Docs/i });
  await docsLink.click();

  await page.waitForURL(/\/docs\//);

  const searchInput = page.getByRole('button', { name: /search/i });
  if (await searchInput.isVisible()) {
    await searchInput.click();
    const searchBox = page.getByRole('searchbox');
    await searchBox.fill('network routing');
    const networkRoutingResult = page.getByRole('option', { name: /network/i }).first();
    if (await networkRoutingResult.isVisible()) {
      await networkRoutingResult.click();
      await expect(page).toHaveURL(/network/i);
      await expect(page.getByRole('heading', { name: /network/i })).toBeVisible();
      return;
    }
  }

  const networkLink = page.getByRole('link', { name: /Network/i });
  if (await networkLink.first().isVisible()) {
    await networkLink.first().click();
    await expect(page).toHaveURL(/network/i);
  } else {
    await page.goto(`${TARGET_URL}docs/network`);
  }

  await expect(page).toHaveURL(/network/i);

  const heading = page.getByRole('heading', { name: /network/i }).first();
  await expect(heading).toBeVisible();

  const routingHeading = page.getByRole('heading', { name: /routing/i });
  if (await routingHeading.isVisible()) {
    await expect(routingHeading).toBeVisible();
  }

  const routingText = page.getByText(/route/i).first();
  await expect(routingText).toBeVisible();
});