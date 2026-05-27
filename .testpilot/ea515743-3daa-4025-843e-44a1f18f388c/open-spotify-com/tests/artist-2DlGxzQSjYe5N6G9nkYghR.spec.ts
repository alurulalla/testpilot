import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Jennifer Lopez | Spotify Artist Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://open.spotify.com/artist/2DlGxzQSjYe5N6G9nkYghR');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Jennifer Lopez/i);
  });

  test('artist heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Jennifer Lopez', level: 1 })).toBeVisible();
  });

  test('monthly listeners text is visible', async ({ page }) => {
    await expect(page.getByText(/monthly listeners/i)).toBeVisible();
  });

  test('Play button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('Follow button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();
  });

  test('More options button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /More options for Jennifer Lopez/i })).toBeVisible();
  });

  test('Popular section heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Popular', level: 2 })).toBeVisible();
  });

  test('popular tracks grid is visible', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'popular tracks' })).toBeVisible();
  });

  test('On The Floor track is visible in popular tracks', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'On The Floor' })).toBeVisible();
  });

  test('navigation bar contains Premium button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Premium' })).toBeVisible();
  });

  test('Sign up button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });

  test('Log in button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('Spotify logo link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Spotify' })).toBeVisible();
  });

  test('Home button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  });

  test('Search functionality is present', async ({ page }) => {
    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /What do you want to play/i })).toBeVisible();
  });

  test('Your Library heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  });

  test('Create playlist button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create playlist' })).toBeVisible();
  });

  test('Browse podcasts link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Browse podcasts' })).toBeVisible();
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

  test('Compilations button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Compilations' })).toBeVisible();
  });

  test('Install App link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Install App' })).toBeVisible();
  });

  test('footer legal links are visible', async ({ page }) => {
    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await expect(mainNav.getByRole('link', { name: 'Legal' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Accessibility' })).toBeVisible();
  });

  test('English language button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('Sign up free button in now playing bar is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();
  });

  test('preview text in now playing bar is visible', async ({ page }) => {
    await expect(page.getByText(/Preview of Spotify/i)).toBeVisible();
  });

  test('On The Floor track link navigates to correct track page', async ({ page }) => {
    const trackLink = page.getByRole('link', { name: 'On The Floor' }).first();
    await expect(trackLink).toHaveAttribute('href', '/track/3C0nOe05EIt1390bVABLyN');
  });

  test("Let's Get Loud track link is visible", async ({ page }) => {
    await expect(page.getByRole('link', { name: "Let's Get Loud" })).toBeVisible();
  });

  test('Discography link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Discography' })).toBeVisible();
  });

  test('Show all link navigates to discography', async ({ page }) => {
    const showAllLink = page.getByRole('link', { name: 'Show all' });
    await expect(showAllLink).toBeVisible();
    await expect(showAllLink).toHaveAttribute('href', '/artist/2DlGxzQSjYe5N6G9nkYghR/discography/all');
  });

  test('clicking Browse podcasts link navigates correctly', async ({ page }) => {
    const browsePodcastsLink = page.getByRole('link', { name: 'Browse podcasts' });
    await browsePodcastsLink.click();
    await expect(page).toHaveURL(/\/genre\/podcasts-web/);
  });

  test('volume slider is present in now playing bar', async ({ page }) => {
    await expect(page.getByRole('slider', { name: 'Change volume' })).toBeVisible();
  });

  test('artist page main region has correct label', async ({ page }) => {
    await expect(page.getByRole('main', { name: /Jennifer Lopez/i })).toBeVisible();
  });

  test('Play On The Floor button is visible in popular tracks', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Play On The Floor by Jennifer Lopez/i })).toBeVisible();
  });

  test('Mute button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mute' })).toBeVisible();
  });

  test('world ranking text is visible', async ({ page }) => {
    await expect(page.getByText(/#121/i).or(page.getByText(/in the world/i))).toBeVisible();
  });
});