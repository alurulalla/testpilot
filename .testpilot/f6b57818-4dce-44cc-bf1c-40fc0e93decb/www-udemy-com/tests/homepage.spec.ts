import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Udemy - Cloudflare Security Check Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Just a moment/i);
  });

  test('main heading "www.udemy.com" is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'www.udemy.com', level: 1 });
    await expect(heading).toBeVisible();
  });

  test('security verification heading is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'Performing security verification', level: 2 });
    await expect(heading).toBeVisible();
  });

  test('security verification description text is visible', async ({ page }) => {
    const description = page.getByText(
      'This website uses a security service to protect against malicious bots.'
    );
    await expect(description).toBeVisible();
  });

  test('additional bot protection description text is visible', async ({ page }) => {
    const description = page.getByText(
      'This page is displayed while the website verifies you are not a bot.'
    );
    await expect(description).toBeVisible();
  });

  test('main landmark is present', async ({ page }) => {
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
  });

  test('Ray ID label is visible in footer', async ({ page }) => {
    const rayId = page.getByText('Ray ID:');
    await expect(rayId).toBeVisible();
  });

  test('Ray ID code value is present', async ({ page }) => {
    const rayIdCode = page.locator('code');
    await expect(rayIdCode).toBeVisible();
    const text = await rayIdCode.textContent();
    expect(text).toBeTruthy();
    expect(text!.trim().length).toBeGreaterThan(0);
  });

  test('Cloudflare link is visible and has correct href', async ({ page }) => {
    const cloudflareLink = page.getByRole('link', { name: 'Cloudflare' });
    await expect(cloudflareLink).toBeVisible();
    await expect(cloudflareLink).toHaveAttribute(
      'href',
      'https://www.cloudflare.com?utm_source=challenge&utm_campaign=m'
    );
  });

  test('Privacy link is visible and has correct href', async ({ page }) => {
    const privacyLink = page.getByRole('link', { name: 'Privacy' });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', 'https://www.cloudflare.com/privacypolicy/');
  });

  test('"Performance and Security by" text is visible', async ({ page }) => {
    const text = page.getByText('Performance and Security by');
    await expect(text).toBeVisible();
  });

  test('both footer links are present', async ({ page }) => {
    const cloudflareLink = page.getByRole('link', { name: 'Cloudflare' });
    const privacyLink = page.getByRole('link', { name: 'Privacy' });
    await expect(cloudflareLink).toBeVisible();
    await expect(privacyLink).toBeVisible();
  });
});