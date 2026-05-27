import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test('Search for iPhone 12 on Amazon.in and verify search results are displayed', async ({ page }) => {
  // Navigate directly to Amazon.in
  await page.goto('https://www.amazon.in/');

  // Verify we landed on the correct page by checking the title
  await expect(page).toHaveTitle(/Amazon\.in/);

  // Locate the search box using accessible role or placeholder
  const searchBox = page.getByRole('searchbox');
  await expect(searchBox).toBeVisible();

  // Type "iphone12" into the search box
  await searchBox.click();
  await searchBox.fill('iphone12');

  // Submit the search by clicking the Go button specifically
  const searchButton = page.getByRole('button', { name: 'Go', exact: true });
  if (await searchButton.isVisible()) {
    await searchButton.click();
  } else {
    await searchBox.press('Enter');
  }

  // Wait for the results page to load
  await page.waitForLoadState('domcontentloaded');

  // Verify the search results page is displayed with relevant results
  // Check that the URL contains the search query
  await expect(page).toHaveURL(/iphone12|iPhone\+12|iPhone12/i);

  // Verify search results are present by checking for result items
  // Use first() to avoid strict mode violation when multiple matching elements exist
  const searchResultsHeading = page.getByText(/results for/i).first();
  await expect(searchResultsHeading).toBeVisible({ timeout: 10000 });

  // Verify that at least one search result item is visible
  // Results typically contain product names with "iPhone" text
  const iPhoneResults = page.getByRole('link', { name: /iphone/i });
  const resultCount = await iPhoneResults.count();
  expect(resultCount).toBeGreaterThan(0);

  // Verify the search input shows the searched term
  const searchInput = page.getByRole('searchbox');
  await expect(searchInput).toHaveValue(/iphone12/i);
});