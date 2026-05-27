import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Cheema Y | Spotify Artist Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://open.spotify.com/artist/0uOUeC51AxGnP6hB8gurwt');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Cheema Y/i);
  });

  test('artist heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Cheema Y', level: 1 })).toBeVisible();
  });

  test('monthly listeners text is visible', async ({ page }) => {
    await expect(page.getByText(/monthly listeners/i)).toBeVisible();
  });

  test('Spotify logo link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Spotify' })).toBeVisible();
  });

  test('navigation buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('Sign up and Log in buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('Follow button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();
  });

  test('Play button for artist is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('More options button for Cheema Y is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'More options for Cheema Y' })).toBeVisible();
  });

  test('Popular heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Popular', level: 2 })).toBeVisible();
  });

  test('popular tracks grid is visible', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'popular tracks' })).toBeVisible();
  });

  test('California Love track link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'California Love' }).first()).toBeVisible();
  });

  test('Tutor track link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Tutor' })).toBeVisible();
  });

  test('The Beast track link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'The Beast' })).toBeVisible();
  });

  test('DXB track link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'DXB' })).toBeVisible();
  });

  test('Police track link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Police' })).toBeVisible();
  });

  test('See more button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'See more' })).toBeVisible();
  });

  test('Popular releases button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Popular releases' })).toBeVisible();
  });

  test('Albums button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Albums' })).toBeVisible();
  });

  test('Singles and EPs button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Singles and EPs' })).toBeVisible();
  });

  test('Bermuda Triangle album link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Bermuda Triangle' }).first()).toBeVisible();
  });

  test('Discography link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Discography' })).toBeVisible();
  });

  test('Show all link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Show all' })).toBeVisible();
  });

  test('Install App link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Install App' })).toBeVisible();
  });

  test('search input is present', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
  });

  test('Your Library heading is present in navigation', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  });

  test('Create playlist button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
  });

  test('Browse podcasts link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Browse podcasts' })).toBeVisible();
  });

  test('Sign up free button is visible in now playing bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
  });

  test('English language button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('footer legal links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
  });

  test('now playing bar preview text is visible', async ({ page }) => {
    await expect(page.getByText(/Preview of Spotify/i)).toBeVisible();
  });

  test('California Love track play button is visible in popular tracks', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Play California Love by Cheema Y/i })
    ).toBeVisible();
  });

  test('clicking California Love link stays on Spotify domain', async ({ page }) => {
    const californiaLoveLink = page.getByRole('link', { name: 'California Love' }).first();
    await expect(californiaLoveLink).toBeVisible();
    const href = await californiaLoveLink.getAttribute('href');
    expect(href).toContain('/track/');
  });

  test('clicking Discography link navigates to discography page', async ({ page }) => {
    const discographyLink = page.getByRole('link', { name: 'Discography' });
    await expect(discographyLink).toBeVisible();
    await discographyLink.click();
    await expect(page).toHaveURL(/\/artist\/0uOUeC51AxGnP6hB8gurwt\/discography/);
  });

  test('Bermuda Triangle album link navigates to album page', async ({ page }) => {
    const bermudaLink = page.getByRole('link', { name: 'Bermuda Triangle' }).first();
    await expect(bermudaLink).toBeVisible();
    const href = await bermudaLink.getAttribute('href');
    expect(href).toContain('/album/');
  });

  test('artist bio text mentions monthly listeners', async ({ page }) => {
    await expect(
      page.getByText(/8,414,099 monthly listeners/i)
    ).toBeVisible();
  });

  test('skip to main content link exists', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  });

  test('main landmark has correct label', async ({ page }) => {
    await expect(page.getByRole('main', { name: /Cheema Y/i })).toBeVisible();
  });

  test('Home button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  });

  test('volume slider is present', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
  });

  test('Mute button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mute' })).toBeVisible();
  });

  test('The Simpsons album link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'The Simpsons' })).toBeVisible();
  });

  test('ANYWAY album link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'ANYWAY' })).toBeVisible();
  });
});