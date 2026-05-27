import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test('Open album 3ad1jliYfvb37tpEjys4JN on Spotify', async ({ page }) => {
  // Navigate directly to the album page
  await page.goto('https://open.spotify.com/album/3ad1jliYfvb37tpEjys4JN');

  // Wait for the page to load
  await page.waitForLoadState('domcontentloaded');

  // Confirm we are on the Spotify web player by checking the page title
  await expect(page).toHaveTitle(/Spotify/i);

  // Verify that the album page has loaded by checking for a heading or key element
  // The album page should show an album name heading or similar content
  const pageHeading = page.getByRole('heading').first();
  await expect(pageHeading).toBeVisible({ timeout: 15000 });

  // Also verify the page URL contains the album ID
  await expect(page).toHaveURL(/3ad1jliYfvb37tpEjys4JN/);
});