import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Spotify Web Player – Trending Songs Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://open.spotify.com/section/0JQ5DB5E8N831KzFzsBBQ2');
  });

  test('page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spotify/i);
  });

  test('Spotify logo link is visible', async ({ page }) => {
    const logo = page.getByRole('link', { name: 'Spotify' });
    await expect(logo).toBeVisible();
  });

  test('Home button is visible', async ({ page }) => {
    const homeBtn = page.getByRole('button', { name: 'Home' });
    await expect(homeBtn).toBeVisible();
  });

  test('Search combobox is present', async ({ page }) => {
    const searchInput = page.getByRole('combobox', { name: 'What do you want to play?' });
    await expect(searchInput).toBeVisible();
  });

  test('Search button is visible', async ({ page }) => {
    const searchBtn = page.getByRole('button', { name: 'Search' });
    await expect(searchBtn).toBeVisible();
  });

  test('Premium button is visible', async ({ page }) => {
    const premiumBtn = page.getByRole('button', { name: 'Premium' });
    await expect(premiumBtn).toBeVisible();
  });

  test('Support button is visible', async ({ page }) => {
    const supportBtn = page.getByRole('button', { name: 'Support' });
    await expect(supportBtn).toBeVisible();
  });

  test('Download button is visible', async ({ page }) => {
    const downloadBtn = page.getByRole('button', { name: 'Download' });
    await expect(downloadBtn).toBeVisible();
  });

  test('Sign up button is visible', async ({ page }) => {
    const signUpBtn = page.getByRole('button', { name: 'Sign up' });
    await expect(signUpBtn).toBeVisible();
  });

  test('Log in button is visible', async ({ page }) => {
    const loginBtn = page.getByRole('button', { name: 'Log in' });
    await expect(loginBtn).toBeVisible();
  });

  test('Install App link is visible and points to /download', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute('href', '/download');
  });

  test('Your Library heading is visible', async ({ page }) => {
    const libraryHeading = page.getByRole('heading', { name: 'Your Library', level: 1 });
    await expect(libraryHeading).toBeVisible();
  });

  test('Create playlist button is visible', async ({ page }) => {
    const createPlaylistBtn = page.getByRole('button', { name: 'Create playlist' });
    await expect(createPlaylistBtn).toBeVisible();
  });

  test('Browse podcasts link is visible', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(browseLink).toBeVisible();
    await expect(browseLink).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('English language button is visible', async ({ page }) => {
    const englishBtn = page.getByRole('button', { name: 'English' });
    await expect(englishBtn).toBeVisible();
  });

  test('Now playing bar – preview text is visible', async ({ page }) => {
    const previewText = page.getByText('Preview of Spotify');
    await expect(previewText).toBeVisible();
  });

  test('Now playing bar – Sign up free button is visible', async ({ page }) => {
    const signUpFreeBtn = page.getByRole('button', { name: 'Sign up free' });
    await expect(signUpFreeBtn).toBeVisible();
  });

  test('Now playing bar – volume slider is present', async ({ page }) => {
    const volumeSlider = page.getByRole('slider', { name: 'Change volume' });
    await expect(volumeSlider).toBeVisible();
  });

  test('Now playing bar – progress slider is present', async ({ page }) => {
    const progressSlider = page.getByRole('slider', { name: 'Change progress' });
    await expect(progressSlider).toBeAttached();
  });

  test('Now playing bar – Mute button is present', async ({ page }) => {
    const muteBtn = page.getByRole('button', { name: 'Mute' });
    await expect(muteBtn).toBeVisible();
  });

  test('Trending songs region is present', async ({ page }) => {
    const trendingRegion = page.getByRole('region', { name: 'Trending songs' });
    await expect(trendingRegion).toBeVisible();
  });

  test('Jackpot song list item is visible', async ({ page }) => {
    const jackpotItem = page.getByRole('listitem').filter({ hasText: 'Jackpot' }).first();
    await expect(jackpotItem).toBeVisible();
  });

  test('Jackpot song link is visible', async ({ page }) => {
    const jackpotLink = page.getByRole('link', { name: 'Jackpot' });
    await expect(jackpotLink).toBeVisible();
  });

  test('Cheema Y artist link is visible', async ({ page }) => {
    const cheemaLink = page.getByRole('link', { name: 'Cheema Y' });
    await expect(cheemaLink).toBeVisible();
  });

  test('Gur Sidhu artist link is visible', async ({ page }) => {
    const gurLink = page.getByRole('link', { name: 'Gur Sidhu' });
    await expect(gurLink).toBeVisible();
  });

  test('On The Floor song link is visible', async ({ page }) => {
    const onTheFloorLink = page.getByRole('link', { name: 'On The Floor' });
    await expect(onTheFloorLink).toBeVisible();
  });

  test('Jennifer Lopez artist link is visible', async ({ page }) => {
    const jloLink = page.getByRole('link', { name: 'Jennifer Lopez' });
    await expect(jloLink).toBeVisible();
  });

  test('Pitbull artist link is visible', async ({ page }) => {
    const pitbullLink = page.getByRole('link', { name: 'Pitbull' });
    await expect(pitbullLink).toBeVisible();
  });

  test('Play Jackpot button is present', async ({ page }) => {
    const playJackpotBtn = page.getByRole('button', { name: 'Play Jackpot' });
    await expect(playJackpotBtn).toBeAttached();
  });

  test('Play On The Floor button is present', async ({ page }) => {
    const playOnTheFloorBtn = page.getByRole('button', { name: 'Play On The Floor' });
    await expect(playOnTheFloorBtn).toBeAttached();
  });

  test('Legal link is visible and points to correct URL', async ({ page }) => {
    const legalLink = page.getByRole('link', { name: 'Legal' });
    await expect(legalLink).toBeVisible();
    await expect(legalLink).toHaveAttribute('href', 'https://www.spotify.com/in-en/legal/');
  });

  test('Privacy Policy link is visible', async ({ page }) => {
    const privacyLink = page.getByRole('link', { name: 'Privacy Policy' });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', 'https://www.spotify.com/in-en/legal/privacy-policy/');
  });

  test('Accessibility link is visible', async ({ page }) => {
    const accessibilityLink = page.getByRole('link', { name: 'Accessibility' });
    await expect(accessibilityLink).toBeVisible();
    await expect(accessibilityLink).toHaveAttribute('href', 'https://www.spotify.com/in-en/accessibility/');
  });

  test('Safety & Privacy Center link is visible', async ({ page }) => {
    const safetyLink = page.getByRole('link', { name: 'Safety & Privacy Center' });
    await expect(safetyLink).toBeVisible();
  });

  test('About Ads link is visible', async ({ page }) => {
    const aboutAdsLink = page.getByRole('link', { name: 'About Ads' });
    await expect(aboutAdsLink).toBeVisible();
  });

  test('navigating to Install App page stays on Spotify domain', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await installLink.click();
    await expect(page).toHaveURL(/open\.spotify\.com\/download/);
  });

  test('navigating to Browse podcasts page stays on Spotify domain', async ({ page }) => {
    const browseLink = page.getByRole('link', { name: 'Browse podcasts' });
    await browseLink.click();
    await expect(page).toHaveURL(/open\.spotify\.com\/genre\/podcasts-web/);
  });

  test('main navigation region is present', async ({ page }) => {
    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await expect(mainNav).toBeVisible();
  });

  test('now playing bar complementary region is present', async ({ page }) => {
    const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
    await expect(nowPlayingBar).toBeVisible();
  });

  test('main content region has correct label', async ({ page }) => {
    const mainContent = page.getByRole('main', { name: 'Spotify – Web Player' });
    await expect(mainContent).toBeVisible();
  });

  test('sign up text is visible in now playing bar', async ({ page }) => {
    const signUpText = page.getByText('Sign up to get unlimited songs and podcasts with occasional ads');
    await expect(signUpText).toBeVisible();
  });

  test('create playlist prompt text is visible', async ({ page }) => {
    const createPlaylistText = page.getByText("Create your first playlist");
    await expect(createPlaylistText).toBeVisible();
  });

  test('podcasts prompt text is visible', async ({ page }) => {
    const podcastsText = page.getByText("Let's find some podcasts to follow");
    await expect(podcastsText).toBeVisible();
  });

  test('resize main navigation slider is present', async ({ page }) => {
    const resizeSlider = page.getByRole('slider', { name: 'Resize main navigation' });
    await expect(resizeSlider).toBeAttached();
  });

  test('skip to main content link is present', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeAttached();
  });
});