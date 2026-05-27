import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

const ARTIST_URL = 'https://open.spotify.com/artist/0QntOArZgiNHoemAzwJPu5';

test('page loads with correct title', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page).toHaveTitle(/Gur Sidhu/);
});

test('artist heading is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('heading', { name: 'Gur Sidhu' }).first()).toBeVisible();
});

test('monthly listeners text is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByText(/monthly listeners/i).first()).toBeVisible();
});

test('Spotify logo link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Spotify' }).first()).toBeVisible();
});

test('navigation bar buttons are present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Premium' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Support' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download' }).first()).toBeVisible();
});

test('Sign up and Log in buttons are visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
});

test('Follow button is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'Follow' }).first()).toBeVisible();
});

test('Play button is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'Play' }).first()).toBeVisible();
});

test('Popular section heading is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('heading', { name: 'Popular' }).first()).toBeVisible();
});

test('popular tracks grid is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('grid', { name: 'popular tracks' }).first()).toBeVisible();
});

test('California Love track link is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'California Love' }).first()).toBeVisible();
});

test('Tutor track link is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Tutor' }).first()).toBeVisible();
});

test('The Beast track link is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'The Beast' }).first()).toBeVisible();
});

test('DXB track link is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'DXB' }).first()).toBeVisible();
});

test('Show all link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Show all' }).first()).toBeVisible();
});

test('search input is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
});

test('English language button is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
});

test('Install App link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Install App' })).toBeVisible();
});

test('Your Library heading is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('heading', { name: 'Your Library' }).first()).toBeVisible();
});

test('Create playlist button is visible', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
});

test('Browse podcasts link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Browse podcasts' })).toBeVisible();
});

test('footer legal links are present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
});

test('now playing bar is present with sign up prompt', async ({ page }) => {
  await page.goto(ARTIST_URL);
  const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
  await expect(nowPlayingBar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
});

test('clicking California Love track navigates to track page', async ({ page }) => {
  await page.goto(ARTIST_URL);
  const trackLink = page.getByRole('link', { name: 'California Love' }).first();
  await expect(trackLink).toBeVisible();
  await trackLink.click();
  await expect(page).toHaveURL(/\/track\/610keNiNVTIkYD0CqeSerg/);
});

test('clicking Discography link navigates to discography page', async ({ page }) => {
  await page.goto(ARTIST_URL);
  const discographyLink = page.getByRole('link', { name: 'Show all' }).first();
  await expect(discographyLink).toBeVisible();
  await discographyLink.click();
  await expect(page).toHaveURL(/\/artist\/0QntOArZgiNHoemAzwJPu5\/discography/);
});

test('artist bio text contains expected content', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByText(/9,802,121 monthly listeners/)).toBeVisible();
});

test('More options for Gur Sidhu button is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'More options for Gur Sidhu' })).toBeVisible();
});

test('Bonafide album link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Bonafide' })).toBeVisible();
});

test('Bermuda Triangle album link is present', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('link', { name: 'Bermuda Triangle' })).toBeVisible();
});

test('volume slider is present in now playing bar', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
});

test('Search button is present in navigation', async ({ page }) => {
  await page.goto(ARTIST_URL);
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
});