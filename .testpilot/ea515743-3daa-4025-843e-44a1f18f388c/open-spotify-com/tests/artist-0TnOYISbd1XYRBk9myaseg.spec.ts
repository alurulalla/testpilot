import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Pitbull | Spotify - Artist Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Pitbull.*Spotify/i);
  });

  test('main heading Pitbull is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pitbull', level: 1 })).toBeVisible();
  });

  test('monthly listeners count is visible', async ({ page }) => {
    await expect(page.getByText(/monthly listeners/i)).toBeVisible();
  });

  test('Spotify logo link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Spotify' })).toBeVisible();
  });

  test('navigation bar buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('Sign up and Log in buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('Install App link is present', async ({ page }) => {
    const installAppLink = page.getByRole('link', { name: 'Install App' });
    await expect(installAppLink).toBeVisible();
    await expect(installAppLink).toHaveAttribute('href', '/download');
  });

  test('Home button is present in navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  });

  test('Search input is present', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'What do you want to play?' })).toBeVisible();
  });

  test('Play button for artist is visible', async ({ page }) => {
    const main = page.getByRole('main', { name: 'Pitbull | Spotify' });
    await expect(main.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('Follow button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();
  });

  test('More options button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'More options for Pitbull' })).toBeVisible();
  });

  test('Popular section heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Popular', level: 2 })).toBeVisible();
  });

  test('popular tracks grid is visible', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'popular tracks' })).toBeVisible();
  });

  test('Give Me Everything track link is present', async ({ page }) => {
    const trackLink = page.getByRole('link', { name: 'Give Me Everything (feat. Nayer)' });
    await expect(trackLink).toBeVisible();
    await expect(trackLink).toHaveAttribute('href', '/track/4QNpBfC0zvjKqPJcyqBy9W');
  });

  test('Time of Our Lives track link is present', async ({ page }) => {
    const trackLink = page.getByRole('link', { name: 'Time of Our Lives' });
    await expect(trackLink).toBeVisible();
    await expect(trackLink).toHaveAttribute('href', '/track/2bJvI42r8EF3wxjOuDav4r');
  });

  test('On The Floor track link is present', async ({ page }) => {
    const trackLink = page.getByRole('link', { name: 'On The Floor' });
    await expect(trackLink).toBeVisible();
  });

  test('Timber track link is present', async ({ page }) => {
    const trackLink = page.getByRole('link', { name: 'Timber' });
    await expect(trackLink).toBeVisible();
    await expect(trackLink).toHaveAttribute('href', '/track/3cHyrEgdyYRjgJKSOiOtcS');
  });

  test('Discography link is present and points to correct URL', async ({ page }) => {
    const discographyLink = page.getByRole('link', { name: 'Discography' });
    await expect(discographyLink).toBeVisible();
    await expect(discographyLink).toHaveAttribute('href', '/artist/0TnOYISbd1XYRBk9myaseg/discography/all');
  });

  test('See more button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'See more' })).toBeVisible();
  });

  test('Popular releases button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Popular releases' })).toBeVisible();
  });

  test('Albums filter button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Albums' })).toBeVisible();
  });

  test('Singles and EPs filter button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Singles and EPs' })).toBeVisible();
  });

  test('Compilations filter button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Compilations' })).toBeVisible();
  });

  test('Your Library heading is present in navigation', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  });

  test('Create playlist button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
  });

  test('Browse podcasts link is present', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Browse podcasts' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/genre/podcasts-web');
  });

  test('English language button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('footer Legal link is present', async ({ page }) => {
    const legalLink = page.getByRole('link', { name: 'Legal' });
    await expect(legalLink).toBeVisible();
  });

  test('footer Privacy Policy link is present', async ({ page }) => {
    const privacyLink = page.getByRole('link', { name: 'Privacy Policy' });
    await expect(privacyLink).toBeVisible();
  });

  test('footer Accessibility link is present', async ({ page }) => {
    const accessibilityLink = page.getByRole('link', { name: 'Accessibility' });
    await expect(accessibilityLink).toBeVisible();
  });

  test('now playing bar sign up free button is present', async ({ page }) => {
    const nowPlayingBar = page.getByRole('complementary', { name: 'Now playing bar' });
    await expect(nowPlayingBar.getByRole('button', { name: 'Sign up free' })).toBeVisible();
  });

  test('volume slider is present and enabled', async ({ page }) => {
    const volumeSlider = page.getByRole('slider', { name: 'Change volume' });
    await expect(volumeSlider).toBeVisible();
    await expect(volumeSlider).toBeEnabled();
  });

  test('now playing bar shows preview message', async ({ page }) => {
    await expect(page.getByText(/Preview of Spotify/i)).toBeVisible();
  });

  test('clicking Discography link navigates to discography page', async ({ page }) => {
    const discographyLink = page.getByRole('link', { name: 'Discography' });
    await expect(discographyLink).toBeVisible();
    await discographyLink.click();
    await expect(page).toHaveURL(/\/artist\/0TnOYISbd1XYRBk9myaseg\/discography/);
  });

  test('clicking Install App link navigates to download page', async ({ page }) => {
    const installLink = page.getByRole('link', { name: 'Install App' });
    await expect(installLink).toBeVisible();
    await installLink.click();
    await expect(page).toHaveURL(/\/download/);
  });

  test('Mr. Worldwide playlist link is present', async ({ page }) => {
    const playlistLink = page.getByRole('link', { name: "Mr. Worldwide's Party" });
    await expect(playlistLink).toBeVisible();
    await expect(playlistLink).toHaveAttribute('href', '/playlist/4n7OwdXR0saBXWlHdOuiT4');
  });

  test('Show all discography link is present', async ({ page }) => {
    const showAllLink = page.getByRole('link', { name: 'Show all' });
    await expect(showAllLink).toBeVisible();
    await expect(showAllLink).toHaveAttribute('href', '/artist/0TnOYISbd1XYRBk9myaseg/discography/all');
  });

  test('first popular track play button is present', async ({ page }) => {
    const playButton = page.getByRole('button', {
      name: /Play Give Me Everything/i,
    });
    await expect(playButton).toBeVisible();
  });

  test('Safety & Privacy Center link is present', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Safety & Privacy Center' });
    await expect(link).toBeVisible();
  });
});