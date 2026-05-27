import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Spotify Web Player - Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spotify/);
  });

  test('Spotify logo is visible', async ({ page }) => {
    const logo = page.locator('a[aria-label="Spotify"], img[alt="Spotify"], [data-testid="spotify-logo"]').first();
    await expect(logo).toBeAttached();
  });

  test('Home heading is visible in main content', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'Home' }).first();
    await expect(heading).toBeAttached();
  });

  test('skip to main content link is present', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });

  test('navigation buttons are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Home' }).first()).toBeAttached();
    await expect(page.getByRole('link', { name: 'Premium' }).first()).toBeAttached();
    await expect(page.getByRole('link', { name: 'Support' }).first()).toBeAttached();
    await expect(page.getByRole('link', { name: 'Download' }).first()).toBeAttached();
  });

  test('Sign up and Log in buttons are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' }).first()).toBeAttached();
    await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeAttached();
  });

  test('search input is present', async ({ page }) => {
    const searchInput = page.getByRole('combobox').first();
    await expect(searchInput).toBeAttached();
  });

  test('Search button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Search' }).first()).toBeAttached();
  });

  test('Your Library heading is visible in sidebar', async ({ page }) => {
    const libraryHeading = page.getByRole('heading', { name: 'Your Library' }).first();
    await expect(libraryHeading).toBeAttached();
  });

  test('Create playlist button is visible in sidebar', async ({ page }) => {
    const createPlaylistBtn = page.getByRole('button', { name: 'Create playlist' }).first();
    await expect(createPlaylistBtn).toBeAttached();
  });

  test('Browse podcasts link is visible', async ({ page }) => {
    const browsePodcasts = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browsePodcasts).toBeAttached();
  });

  test('Install App link is visible', async ({ page }) => {
    const installApp = page.getByRole('link', { name: 'Install App' }).first();
    await expect(installApp).toBeAttached();
  });

  test('English language button is visible', async ({ page }) => {
    const englishBtn = page.getByRole('button', { name: /English/i }).first();
    await expect(englishBtn).toBeAttached();
  });

  test('Now playing bar preview text is visible', async ({ page }) => {
    const previewText = page.getByText(/Preview of Spotify/i).first();
    await expect(previewText).toBeAttached();
  });

  test('Sign up free button in now playing bar is visible', async ({ page }) => {
    const signUpFreeBtn = page.getByRole('button', { name: /Sign up free/i }).first();
    await expect(signUpFreeBtn).toBeAttached();
  });

  test('Playback controls are present in now playing bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Previous' }).first()).toBeAttached();
    await expect(page.getByRole('button', { name: /Play|Pause/i }).first()).toBeAttached();
    await expect(page.getByRole('button', { name: 'Next' }).first()).toBeAttached();
  });

  test('volume slider is visible', async ({ page }) => {
    const volumeSlider = page.getByRole('slider', { name: /volume/i }).first();
    await expect(volumeSlider).toBeAttached();
  });

  test('Mute button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Mute/i }).first()).toBeAttached();
  });

  test('Trending songs region is visible', async ({ page }) => {
    const trendingSection = page.getByRole('region', { name: /Trending/i }).first();
    await expect(trendingSection).toBeAttached();
  });

  test('Trending songs grid is visible', async ({ page }) => {
    const trendingSection = page.getByRole('region', { name: /Trending/i }).first();
    await expect(trendingSection).toBeAttached();
  });

  test('Show all link for Trending songs is visible', async ({ page }) => {
    const showAllLink = page.getByRole('link', { name: 'Show all' }).first();
    await expect(showAllLink).toBeVisible();
  });

  test('Jackpot song entry is visible in trending', async ({ page }) => {
    const jackpotLink = page.getByRole('link', { name: 'Jackpot' }).first();
    await expect(jackpotLink).toBeVisible();
  });

  test('On The Floor song entry is visible in trending', async ({ page }) => {
    const onTheFloorLink = page.getByRole('link', { name: 'On The Floor' }).first();
    await expect(onTheFloorLink).toBeVisible();
  });

  test('artist links are visible in trending', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Cheema Y' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gur Sidhu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jennifer Lopez' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pitbull' })).toBeVisible();
  });

  test('footer legal links are present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'About Ads' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Accessibility' })).toBeVisible();
  });

  test('Safety & Privacy Center link is present', async ({ page }) => {
    const safetyLink = page.getByRole('link', { name: 'Safety & Privacy Center' });
    await expect(safetyLink).toBeVisible();
  });

  test('navigates to download page via Install App link', async ({ page }) => {
    const installAppLink = page.getByRole('link', { name: 'Install App' }).first();
    await expect(installAppLink).toHaveAttribute('href', '/download');
  });

  test('Browse podcasts link has correct href', async ({ page }) => {
    const browsePodcasts = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browsePodcasts).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('Spotify logo links to home', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: 'Spotify' }).first();
    await expect(logoLink).toHaveAttribute('href', '/');
  });

  test('main navigation is present', async ({ page }) => {
    const mainNav = page.getByRole('navigation', { name: 'Main' }).first();
    await expect(mainNav).toBeVisible();
  });

  test('Your Library grid is present', async ({ page }) => {
    const libraryGrid = page.getByRole('grid', { name: 'Your Library' });
    await expect(libraryGrid).toBeVisible();
  });

  test('progress slider is present in now playing bar', async ({ page }) => {
    const progressSlider = page.getByRole('slider', { name: /progress/i }).first();
    await expect(progressSlider).toBeAttached();
  });

  test('preview sign up message is visible', async ({ page }) => {
    const previewMessage = page.getByText('Sign up to get unlimited songs and podcasts with occasional ads. No credit card needed.');
    await expect(previewMessage).toBeVisible();
  });

  test('Create button is visible in sidebar', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: 'Create' }).first();
    await expect(createBtn).toBeVisible();
  });

  test('create playlist helper text is visible', async ({ page }) => {
    await expect(page.getByText('Create your first playlist')).toBeVisible();
    await expect(page.getByText("It's easy, we'll help you")).toBeVisible();
  });

  test('podcast follow helper text is visible', async ({ page }) => {
    await expect(page.getByText("Let's find some podcasts to follow")).toBeVisible();
  });

  test('Show all link navigates to trending songs section', async ({ page }) => {
    const showAllLink = page.getByRole('link', { name: 'Show all' }).first();
    await expect(showAllLink).toHaveAttribute('href', '/section/0JQ5DB5E8N831KzFzsBBQ2');
  });

  test('Enable shuffle switch is present', async ({ page }) => {
    const shuffleSwitch = page.getByRole('switch', { name: 'Enable shuffle' });
    await expect(shuffleSwitch).toBeAttached();
  });

  test('Disable repeat checkbox is present', async ({ page }) => {
    const repeatCheckbox = page.getByRole('checkbox', { name: 'Disable repeat' });
    await expect(repeatCheckbox).toBeAttached();
  });
});