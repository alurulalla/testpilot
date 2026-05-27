import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Spotify Web Player - Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spotify - Web Player: Music for everyone/i);
  });

  test('Spotify logo is visible', async ({ page }) => {
    const logo = page.getByRole('img', { name: 'Spotify' });
    await expect(logo).toBeVisible();
  });

  test('main heading "Home" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  });

  test('navigation buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('Sign up and Log in buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('search combobox is present', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
  });

  test('search button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  test('Your Library heading is visible in navigation', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  });

  test('Create playlist button is visible in library navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
  });

  test('Install App link is visible and has correct href', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute('href', '/download');
  });

  test('Browse podcasts link is visible', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browseLink).toBeVisible();
  });

  test('Trending songs region is visible', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Trending songs' })).toBeVisible();
  });

  test('Trending songs grid is visible', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Trending songs' })).toBeVisible();
  });

  test('Show all link for Trending songs is visible', async ({ page }) => {
    const showAllLink = page.getByRole('link', { name: 'Show all' }).first();
    await expect(showAllLink).toBeVisible();
  });

  test('footer legal links are present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'About Ads' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
  });

  test('Safety & Privacy Center link has correct href', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Safety & Privacy Center' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.spotify.com/in-en/safetyandprivacy/');
  });

  test('English language button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('Now playing bar preview text is visible', async ({ page }) => {
    const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
    await expect(nowPlayingBar).toBeVisible();
    await expect(nowPlayingBar.getByText('Preview of Spotify')).toBeVisible();
  });

  test('Sign up free button is visible in now playing bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
  });

  test('preview message about sign up is visible', async ({ page }) => {
    await expect(
      page.getByText('Sign up to get unlimited songs and podcasts with occasional ads. No credit card needed.')
    ).toBeVisible();
  });

  test('volume slider is present', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
  });

  test('progress slider is present in now playing bar', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change progress' })).toBeVisible();
  });

  test('media control buttons exist in now playing bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  });

  test('Mute button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mute' })).toBeVisible();
  });

  test('skip to main content link is present', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });

  test('Jackpot track is listed in Trending songs', async ({ page }) => {
    await expect(page.getByRole('row', { name: 'Jackpot' })).toBeVisible();
  });

  test('On The Floor track is listed in Trending songs', async ({ page }) => {
    await expect(page.getByRole('row', { name: 'On The Floor' })).toBeVisible();
  });

  test('artist links are visible in trending songs', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Cheema Y' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gur Sidhu' })).toBeVisible();
  });

  test('Jennifer Lopez and Pitbull artist links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Jennifer Lopez' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pitbull' })).toBeVisible();
  });

  test('clicking Browse podcasts link navigates to podcasts page', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browseLink).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('Your Library grid is visible', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Your Library' })).toBeVisible();
  });

  test('Create playlist helper text is visible', async ({ page }) => {
    await expect(page.getByText("Create your first playlist")).toBeVisible();
  });

  test('podcasts helper text is visible', async ({ page }) => {
    await expect(page.getByText("Let's find some podcasts to follow")).toBeVisible();
  });

  test('Enable shuffle switch is present', async ({ page }) => {
    await expect(page.getByRole('switch', { name: 'Enable shuffle' })).toBeVisible();
  });

  test('search input can receive text', async ({ page }) => {
    const searchInput = page.getByRole('combobox', { name: 'What do you want to play?' });
    await searchInput.click();
    await searchInput.fill('test artist');
    await expect(searchInput).toHaveValue('test artist');
  });
});