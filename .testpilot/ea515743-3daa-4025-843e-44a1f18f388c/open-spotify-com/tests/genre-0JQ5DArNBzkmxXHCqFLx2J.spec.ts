import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Spotify Podcasts Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://open.spotify.com/genre/0JQ5DArNBzkmxXHCqFLx2J');
  });

  test('page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spotify/i);
  });

  test('main heading "Podcasts" is visible', async ({ page }) => {
    await expect(page.getByRole('main', { name: 'Podcasts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Podcasts', level: 1 })).toBeVisible();
  });

  test('Spotify logo link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Spotify' })).toBeVisible();
  });

  test('navigation bar buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  test('search combobox is visible', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
  });

  test('Premium, Support, and Download buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('Sign up and Log in buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('Install App link is present and has correct href', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute('href', '/download');
  });

  test('Your Library heading is visible in navigation', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  });

  test('Create playlist button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
  });

  test('Browse podcasts link is present and has correct href', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browseLink).toBeVisible();
    await expect(browseLink).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('English language button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('footer legal links are present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'About Ads' })).toBeVisible();
  });

  test('Safety & Privacy Center link is present', async ({ page }) => {
    const safetyLink = page.getByRole('link', { name: 'Safety & Privacy Center' });
    await expect(safetyLink).toBeVisible();
    await expect(safetyLink).toHaveAttribute('href', 'https://www.spotify.com/in-en/safetyandprivacy/');
  });

  test('Now playing bar is visible with preview text', async ({ page }) => {
    const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
    await expect(nowPlayingBar).toBeVisible();
    await expect(nowPlayingBar.getByText('Preview of Spotify')).toBeVisible();
  });

  test('Sign up free button in now playing bar is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
  });

  test('preview message is visible', async ({ page }) => {
    await expect(
      page.getByText('Sign up to get unlimited songs and podcasts with occasional ads. No credit card needed.')
    ).toBeVisible();
  });

  test('Best episodes of the week region is visible', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Best episodes of the week' })).toBeVisible();
  });

  test('episode link "Chris Williamson On Champion Mindset" is visible', async ({ page }) => {
    const episodeLink = page.getByRole('link', {
      name: /Chris Williamson On Champion Mindset/i,
    });
    await expect(episodeLink.first()).toBeVisible();
  });

  test('episode link "Karuna Nundy on the Pursuit of Excellence" is visible', async ({ page }) => {
    const episodeLink = page.getByRole('link', {
      name: /Karuna Nundy on the Pursuit of Excellence/i,
    });
    await expect(episodeLink.first()).toBeVisible();
  });

  test('skip to main content link exists', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });

  test('volume slider is present', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
  });

  test('progress slider is present', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change progress' })).toBeVisible();
  });

  test('clicking Browse podcasts navigates to podcasts page', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await browseLink.click();
    await expect(page).toHaveURL(/\/genre\/podcasts-web/);
  });

  test('clicking Install App link navigates to download page', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await installLink.click();
    await expect(page).toHaveURL(/\/download/);
  });

  test('main navigation is present', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('Your Library grid is present', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Your Library' })).toBeVisible();
  });

  test('create playlist informational text is visible', async ({ page }) => {
    await expect(page.getByText("Create your first playlist It's easy, we'll help you")).toBeVisible();
  });

  test('find podcasts informational text is visible', async ({ page }) => {
    await expect(
      page.getByText("Let's find some podcasts to follow We'll keep you updated on new episodes")
    ).toBeVisible();
  });
});