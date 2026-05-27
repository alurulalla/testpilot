import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

const PAGE_URL = 'https://open.spotify.com/album/3sysiYphqNRQw7VKLCg1yE?highlight=spotify:track:3C0nOe05EIt1390bVABLyN';

test('page loads with correct title', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page).toHaveTitle(/Love\?/);
});

test('main heading Love? is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('heading', { name: 'Love?' }).first()).toBeVisible();
});

test('album type label is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByText('Album').first()).toBeVisible();
});

test('album metadata is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByTestId('release-date')).toBeVisible();
  await expect(page.getByText(/17 songs/).first()).toBeVisible();
});

test('Jennifer Lopez artist link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  const artistLinks = page.getByRole('link', { name: 'Jennifer Lopez' });
  await expect(artistLinks.first()).toBeVisible();
});

test('Spotify logo link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Spotify' }).first()).toBeVisible();
});

test('navigation buttons are present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Home' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Premium' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
});

test('search input is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('combobox').first()).toBeVisible();
});

test('Play button for album is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();
});

test('Save to Your Library button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Save to Your Library' }).first()).toBeVisible();
});

test('More options button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: /More options/ }).first()).toBeVisible();
});

test('track list grid is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('grid').first()).toBeVisible();
});

test('On The Floor track is highlighted and visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  const trackLink = page.getByRole('link', { name: 'On The Floor' }).first();
  await expect(trackLink).toBeVisible();
});

test('Your Library section is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('heading', { name: 'Your Library' }).first()).toBeVisible();
});

test('Create playlist button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'Create playlist' }).first()).toBeVisible();
});

test('Browse podcasts link is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Browse podcasts' }).first()).toBeVisible();
});

test('footer legal links are visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: 'Legal' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy Policy' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Accessibility' }).first()).toBeVisible();
});

test('English language button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: /English/ }).first()).toBeVisible();
});

test('now playing bar preview text is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByText(/Preview of Spotify/).first()).toBeVisible();
});

test('sign up free button in now playing bar is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('link', { name: /Sign up free/ }).first()).toBeVisible();
});

test('Install App link navigates correctly', async ({ page }) => {
  await page.goto(PAGE_URL);
  const installAppLink = page.getByRole('link', { name: 'Install App' });
  await expect(installAppLink).toBeVisible();
  await expect(installAppLink).toHaveAttribute('href', '/download');
});

test('Jennifer Lopez artist link navigates to artist page', async ({ page }) => {
  await page.goto(PAGE_URL);
  const artistLink = page.getByRole('link', { name: 'Jennifer Lopez' }).first();
  await expect(artistLink).toHaveAttribute('href', '/artist/2DlGxzQSjYe5N6G9nkYghR');
});

test('volume slider is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
});

test('progress slider is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('slider', { name: 'Change progress' })).toBeVisible();
});

test('List view combobox is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('combobox').first()).toBeVisible();
});

test('track list column headers are visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Title/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
});

test('clicking Jennifer Lopez artist link navigates to artist page', async ({ page }) => {
  await page.goto(PAGE_URL);
  const artistLink = page.getByRole('link', { name: 'Jennifer Lopez' }).first();
  await artistLink.click();
  await expect(page).toHaveURL(/\/artist\/2DlGxzQSjYe5N6G9nkYghR/);
});

test('Skip to main content link is present', async ({ page }) => {
  await page.goto(PAGE_URL);
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeAttached();
});

test('album artwork button is visible', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.getByRole('button', { name: 'View album artwork' })).toBeVisible();
});