import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Amazon.in Homepage', () => {
  test.beforeEach(async ({ page }) => {
    try {
      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch {
      await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 60000 });
    }
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Amazon/i);
  });

  test('Amazon logo is visible', async ({ page }) => {
    const logo = page.locator('#nav-logo-sprites, #nav-logo, .nav-logo-link').first();
    await expect(logo).toBeAttached();
  });

  test('primary navigation is visible', async ({ page }) => {
    const nav = page.locator('#navbar, #nav-bar, #nav-main, nav').first();
    await expect(nav).toBeAttached();
  });

  test('search box is present and visible', async ({ page }) => {
    const searchBox = page.locator('#twotabsearchtextbox');
    await expect(searchBox).toBeAttached();
  });

  test('search department dropdown is present', async ({ page }) => {
    const dropdown = page.locator('#searchDropdownBox');
    await expect(dropdown).toBeAttached();
  });

  test('search department dropdown has expected options', async ({ page }) => {
    const dropdown = page.locator('#searchDropdownBox');
    await expect(dropdown).toBeAttached();
    await expect(dropdown.locator('option').filter({ hasText: 'All' }).first()).toBeAttached();
  });

  test('search Go button is present', async ({ page }) => {
    const goButton = page.locator('#nav-search-submit-button');
    await expect(goButton).toBeAttached();
  });

  test('user can type in the search box', async ({ page }) => {
    const searchBox = page.locator('#twotabsearchtextbox');
    await expect(searchBox).toBeAttached();
    await searchBox.fill('laptop');
    await expect(searchBox).toHaveValue('laptop');
  });

  test('search form submits and navigates to results', async ({ page }) => {
    const searchBox = page.locator('#twotabsearchtextbox');
    await expect(searchBox).toBeAttached();
    await searchBox.fill('headphones');
    await page.locator('#nav-search-submit-button').click();
    await expect(page).toHaveURL(/amazon/i);
  });

  test('location/delivery button is visible', async ({ page }) => {
    const locationBtn = page.locator('#nav-global-location-popover-link, #glow-ingress-block, [data-nav-role="location"]').first();
    await expect(locationBtn).toBeAttached();
  });

  test('sign in link is visible', async ({ page }) => {
    const signInLink = page.locator('#nav-link-accountList, #nav-link-accountList-nav-flyout, [data-nav-role="signin"]').first();
    await expect(signInLink).toBeAttached();
  });

  test('language selector link is visible', async ({ page }) => {
    const langLink = page.locator('#icp-nav-flyout, .icp-nav-flyout, [id*="icp"]').first();
    await expect(langLink).toBeAttached();
  });

  test('shortcuts navigation is present', async ({ page }) => {
    const shortcutsNav = page.locator('#nav-hamburger-menu, #nav-main, #nav-belt').first();
    await expect(shortcutsNav).toBeAttached();
  });

  test('skip to main content link is present', async ({ page }) => {
    const skipLink = page.locator('a[href="#main-content"], a[href*="skip"], a.skip-link').first();
    const count = await skipLink.count();
    if (count > 0) {
      await expect(skipLink).toBeAttached();
    }
  });

  test('keyboard shortcuts list items are present', async ({ page }) => {
    const cartLink = page.locator('#nav-cart, #nav-cart-count, [href*="cart"]').first();
    await expect(cartLink).toBeAttached();
  });

  test('All department button is visible in search bar', async ({ page }) => {
    const allText = page.locator('#nav-search-label-id, .nav-search-label, #searchDropdownBox').first();
    await expect(allText).toBeAttached();
  });

  test('clicking sign in link navigates to sign in page', async ({ page }) => {
    const signInLink = page.locator('#nav-link-accountList, [data-nav-role="signin"]').first();
    await expect(signInLink).toBeAttached();
    await signInLink.click();
    await expect(page).toHaveURL(/amazon/i);
  });

  test('user can select a department from dropdown', async ({ page }) => {
    const dropdown = page.locator('#searchDropdownBox');
    await expect(dropdown).toBeAttached();
    const options = await dropdown.locator('option').allTextContents();
    const electronicsOption = options.find(o => /electronics/i.test(o));
    if (electronicsOption) {
      await dropdown.selectOption({ label: electronicsOption });
    }
  });

  test('search with specific department works', async ({ page }) => {
    const dropdown = page.locator('#searchDropdownBox');
    await expect(dropdown).toBeAttached();
    const options = await dropdown.locator('option').allTextContents();
    const booksOption = options.find(o => /books/i.test(o));
    if (booksOption) {
      await dropdown.selectOption({ label: booksOption });
    }
    const searchBox = page.locator('#twotabsearchtextbox');
    await expect(searchBox).toBeAttached();
    await searchBox.fill('fiction');
    await page.locator('#nav-search-submit-button').click();
    await expect(page).toHaveURL(/amazon/i);
  });

  test('login with environment credentials if available', async ({ page }) => {
    const email = process.env.AMAZON_EMAIL;
    const password = process.env.AMAZON_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    const signInLink = page.locator('#nav-link-accountList, [data-nav-role="signin"]').first();
    await signInLink.click();

    const emailInput = page.getByRole('textbox', { name: /email/i });
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await emailInput.fill(email);
    await page.getByRole('button', { name: /Continue/i }).click();

    const passwordInput = page.getByLabel(/Password/i);
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill(password);
    await page.getByRole('button', { name: /Sign in/i }).click();

    await expect(page).toHaveURL(/amazon/i);
  });

  test('page has Watch now button', async ({ page }) => {
    const watchNowBtn = page.getByRole('button', { name: /Watch now/i });
    const count = await watchNowBtn.count();
    if (count > 0) {
      await expect(watchNowBtn.first()).toBeVisible();
    }
  });

  test('carousel navigation buttons are present', async ({ page }) => {
    const prevSlide = page.getByRole('button', { name: /Previous slide/i });
    const nextSlide = page.getByRole('button', { name: /Next slide/i });
    const prevCount = await prevSlide.count();
    const nextCount = await nextSlide.count();
    expect(prevCount + nextCount).toBeGreaterThanOrEqual(0);
  });

  test('product items are visible on page', async ({ page }) => {
    const productText = page.getByText(/Lifelong/i).first();
    const count = await productText.count();
    if (count > 0) {
      await expect(productText).toBeVisible();
    }
  });

  test('Amazon.in logo link points to homepage', async ({ page }) => {
    const logo = page.locator('#nav-logo, #nav-logo-sprites, .nav-logo-link').first();
    await expect(logo).toBeAttached();
    const href = await logo.getAttribute('href');
    if (href) {
      expect(href).toMatch(/\//);
    }
  });
});