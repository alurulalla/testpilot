import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Spotify Download Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${TARGET_URL}/download`);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spotify.*Download/i);
  });

  test('main heading "Download Spotify" is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 2 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Download Spotify');
  });

  test('Spotify logo is visible in main content', async ({ page }) => {
    const main = page.getByRole('main');
    const logo = main.getByRole('img', { name: 'Spotify' });
    await expect(logo).toBeVisible();
  });

  test('download description text is visible', async ({ page }) => {
    await expect(
      page.getByText('Enjoy high-quality audio, offline playback')
    ).toBeVisible();
  });

  test('"Download the free app" link is present and has correct href', async ({ page }) => {
    const downloadLink = page.getByRole('link', { name: 'Download the free app' });
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute('href', 'https://download.scdn.co/SpotifyInstaller.zip');
  });

  test('navigation bar buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('"Install App" link is present in nav', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute('href', '/download');
  });

  test('Spotify home link is present', async ({ page }) => {
    const homeLink = page.getByRole('link', { name: 'Spotify' }).first();
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute('href', '/');
  });

  test('search box is present and accessible', async ({ page }) => {
    const searchBox = page.getByRole('combobox', { name: 'What do you want to play?' });
    await expect(searchBox).toBeVisible();
  });

  test('Your Library navigation heading is visible', async ({ page }) => {
    const libraryHeading = page.getByRole('heading', { name: 'Your Library' });
    await expect(libraryHeading).toBeVisible();
  });

  test('"Create playlist" button is visible', async ({ page }) => {
    const createPlaylistButton = page.getByRole('button', { name: 'Create playlist' });
    await expect(createPlaylistButton).toBeVisible();
  });

  test('"Browse podcasts" link is visible', async ({ page }) => {
    const browsePodcastsLink = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browsePodcastsLink).toBeVisible();
    await expect(browsePodcastsLink).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('footer Company section links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'About' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jobs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'For the Record' })).toBeVisible();
  });

  test('footer Communities section links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'For Artists' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Developers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Advertising' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Investors' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vendors' })).toBeVisible();
  });

  test('footer legal links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
  });

  test('now playing bar preview text is visible', async ({ page }) => {
    const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
    await expect(nowPlayingBar.getByText('Preview of Spotify')).toBeVisible();
    await expect(
      nowPlayingBar.getByText('Sign up to get unlimited songs and podcasts')
    ).toBeVisible();
  });

  test('"Sign up free" button in now playing bar is visible', async ({ page }) => {
    const signUpFreeButton = page.getByRole('button', { name: 'Sign up free' });
    await expect(signUpFreeButton).toBeVisible();
  });

  test('English language button is visible', async ({ page }) => {
    const englishButton = page.getByRole('button', { name: 'English' });
    await expect(englishButton).toBeVisible();
  });

  test('volume slider is present', async ({ page }) => {
    const volumeSlider = page.getByRole('slider', { name: 'Change volume' });
    await expect(volumeSlider).toBeVisible();
  });

  test('Skip to main content link is present', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });

  test('clicking "Browse podcasts" navigates to podcasts page', async ({ page }) => {
    const browsePodcastsLink = page.getByRole('link', { name: 'Browse podcasts' });
    await browsePodcastsLink.click();
    await expect(page).toHaveURL(/\/genre\/podcasts-web/);
  });

  test('Home button is present and clickable', async ({ page }) => {
    const homeButton = page.getByRole('button', { name: 'Home' });
    await expect(homeButton).toBeVisible();
    await homeButton.click();
    await expect(page).toHaveURL(/open\.spotify\.com/);
  });

  test('main content area has separator between content and footer nav', async ({ page }) => {
    const main = page.getByRole('main');
    const separator = main.getByRole('separator');
    await expect(separator).toBeAttached();
  });

  test('Support link in footer has correct href', async ({ page }) => {
    const supportLink = page.getByRole('link', { name: 'Support' });
    await expect(supportLink).toBeVisible();
    await expect(supportLink).toHaveAttribute('href', 'https://support.spotify.com/');
  });
});