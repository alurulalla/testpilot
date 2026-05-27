import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

const PAGE_URL = 'https://open.spotify.com/album/6a7nrbUhXwFEJQ1xWCbNnh?highlight=spotify:track:0JOAMHwHFGKbPOwfM26fL7';

test('page loads and has correct title', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page).toHaveTitle(/Bermuda Triangle/i);
});

test('album heading is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('heading', { name: 'Bermuda Triangle', level: 1 })).toBeVisible();
});

test('album metadata is displayed', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByText('Album')).toBeVisible();
  await expect(page.getByText(/8 songs/i)).toBeVisible();
});

test('artist links are visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  const cheemaYLinks = page.getByRole('link', { name: 'Cheema Y' });
  await expect(cheemaYLinks.first()).toBeVisible();
  const gurSidhuLinks = page.getByRole('link', { name: 'Gur Sidhu' });
  await expect(gurSidhuLinks.first()).toBeVisible();
});

test('Cheema Y artist link has correct href', async ({ page }) => {
  await page.goto(PAGE_URL);
  const cheemaYLink = page.getByRole('link', { name: 'Cheema Y' }).first();
  await expect(cheemaYLink).toHaveAttribute('href', '/artist/0uOUeC51AxGnP6hB8gurwt');
});

test('Gur Sidhu artist link has correct href', async ({ page }) => {
  await page.goto(PAGE_URL);
  const gurSidhuLink = page.getByRole('link', { name: 'Gur Sidhu' }).first();
  await expect(gurSidhuLink).toHaveAttribute('href', '/artist/0QntOArZgiNHoemAzwJPu5');
});

test('Spotify logo link is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Spotify' })).toBeVisible();
});

test('navigation bar has Home button', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
});

test('search input is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
});

test('Sign up button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
});

test('Log in button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('Premium button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
});

test('album play button is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  const playButtons = page.getByRole('button', { name: 'Play' });
  await expect(playButtons.first()).toBeVisible();
});

test('Save to Your Library button is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Save to Your Library' })).toBeVisible();
});

test('More options button for album is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'More options for Bermuda Triangle' })).toBeVisible();
});

test('track list grid is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('grid', { name: 'Bermuda Triangle' })).toBeVisible();
});

test('Rebel track link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Rebel' })).toBeVisible();
});

test('Money 2X track link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Money 2X' })).toBeVisible();
});

test('Love Salary track link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Love Salary' })).toBeVisible();
});

test('Your Library section heading is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
});

test('Browse podcasts link is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Browse podcasts' })).toBeVisible();
});

test('Install App link is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Install App' })).toBeVisible();
});

test('footer legal links are present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
});

test('English language button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
});

test('Sign up free button in now playing bar is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
});

test('Preview of Spotify text is visible for non-logged-in user', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByText('Preview of Spotify')).toBeVisible();
});

test('Create playlist button is present in sidebar', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
});

test('View album artwork button is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'View album artwork' })).toBeVisible();
});

test('volume slider is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
});

test('navigating to Cheema Y artist page works', async ({ page }) => {
  await page.goto(PAGE_URL);
  const cheemaYLink = page.getByRole('link', { name: 'Cheema Y' }).first();
  await cheemaYLink.click();
  await expect(page).toHaveURL(/\/artist\/0uOUeC51AxGnP6hB8gurwt/);
});

test('navigating to Rebel track page works', async ({ page }) => {
  await page.goto(PAGE_URL);
  await page.getByRole('link', { name: 'Rebel' }).click();
  await expect(page).toHaveURL(/\/track\/6JHCz2iCn7Arxxx0GRBSov/);
});

test('column headers in track list are present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Title/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
});

test('Bermuda Triangle top bar text is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  const banner = page.getByRole('banner', { name: 'Top bar and user menu' });
  await expect(banner.getByText('Bermuda Triangle')).toBeVisible();
});