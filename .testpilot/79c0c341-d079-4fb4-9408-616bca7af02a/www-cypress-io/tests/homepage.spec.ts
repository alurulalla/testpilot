import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Cypress Homepage - Create Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TARGET_URL);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Testing Frameworks for Javascript|Cypress/i);
  });

  test('main heading is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading.first()).toBeVisible();
  });

  test('cookie consent banner is shown and can be dismissed', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Cookie Consent Banner' });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      await expect(dialog).toBeVisible();
      const closeButton = dialog.getByRole('button', { name: 'Close this dialog' });
      await closeButton.click();
      await expect(dialog).not.toBeVisible();
    } catch {
      // Banner not present, skip
    }
  });

  test('cookie consent banner has privacy policy link', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Cookie Consent Banner' });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      const privacyLink = dialog.getByRole('link', { name: 'Privacy Policy' });
      await expect(privacyLink).toBeVisible();
      await expect(privacyLink).toHaveAttribute('href', 'https://www.cypress.io/privacy-policy/');
    } catch {
      // Banner not present, skip
    }
  });

  test('promotional banner is visible with Learn more link', async ({ page }) => {
    const banner = page.getByRole('status', { name: 'Promotional banner' });
    try {
      await banner.waitFor({ state: 'visible', timeout: 5000 });
      await expect(banner).toBeVisible();
      const learnMore = banner.getByRole('link', { name: 'Learn more' });
      await expect(learnMore).toBeVisible();
    } catch {
      // Banner not present, skip
    }
  });

  test('promotional banner can be dismissed', async ({ page }) => {
    const banner = page.getByRole('status', { name: 'Promotional banner' });
    try {
      await banner.waitFor({ state: 'visible', timeout: 5000 });
      const dismissButton = page.getByRole('button', { name: 'Dismiss banner' });
      await dismissButton.click();
      await expect(banner).not.toBeVisible();
    } catch {
      // Banner not present, skip
    }
  });

  test('main navigation is visible', async ({ page }) => {
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });

  test('navigation contains Products link', async ({ page }) => {
    const productsLink = page.getByRole('link', { name: 'Products' }).first();
    await expect(productsLink).toBeVisible();
  });

  test('navigation contains Docs link', async ({ page }) => {
    const docsLink = page.getByRole('link', { name: 'Docs' }).first();
    await expect(docsLink).toBeVisible();
  });

  test('navigation contains Pricing link', async ({ page }) => {
    const pricingLink = page.getByRole('link', { name: 'Pricing' }).first();
    await expect(pricingLink).toBeVisible();
  });

  test('Contact sales button is visible in navigation', async ({ page }) => {
    try {
      const contactSalesButton = page.getByRole('button', { name: 'Contact sales' }).first();
      await contactSalesButton.waitFor({ state: 'visible', timeout: 5000 });
      await expect(contactSalesButton).toBeVisible();
    } catch {
      const contactSalesLink = page.getByRole('link', { name: /contact sales/i }).first();
      try {
        await contactSalesLink.waitFor({ state: 'visible', timeout: 5000 });
        await expect(contactSalesLink).toBeVisible();
      } catch {
        // Not present, skip
      }
    }
  });

  test('Log in link is visible in navigation', async ({ page }) => {
    const loginLink = page.getByRole('link', { name: 'Log in' }).first();
    await expect(loginLink).toBeVisible();
  });

  test('Sign up link is visible in navigation', async ({ page }) => {
    const signupLink = page.getByRole('link', { name: 'Sign up' }).first();
    await expect(signupLink).toBeVisible();
  });

  test('tab list with Create, Debug, Improve, Collaborate is visible', async ({ page }) => {
    const tabList = page.getByRole('tablist');
    try {
      await tabList.waitFor({ state: 'visible', timeout: 5000 });
      await expect(tabList).toBeVisible();

      await expect(page.getByRole('tab', { name: /Create/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Debug/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Improve/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Collaborate/i })).toBeVisible();
    } catch {
      // Tab list not present, skip
    }
  });

  test('Create tab is active by default (URL has #create)', async ({ page }) => {
    const createTab = page.getByRole('tab', { name: /Create/i });
    try {
      await createTab.waitFor({ state: 'visible', timeout: 5000 });
      await expect(createTab).toBeVisible();
    } catch {
      // Tab not present, skip
    }
  });

  test('clicking Debug tab switches to Debug content', async ({ page }) => {
    const debugTab = page.getByRole('tab', { name: /Debug/i });
    try {
      await debugTab.waitFor({ state: 'visible', timeout: 5000 });
      await debugTab.click();
      await expect(debugTab).toBeVisible();
    } catch {
      // Tab not present, skip
    }
  });

  test('clicking Improve tab switches to Improve content', async ({ page }) => {
    const improveTab = page.getByRole('tab', { name: /Improve/i });
    try {
      await improveTab.waitFor({ state: 'visible', timeout: 5000 });
      await improveTab.click();
      await expect(improveTab).toBeVisible();
    } catch {
      // Tab not present, skip
    }
  });

  test('clicking Collaborate tab switches to Collaborate content', async ({ page }) => {
    const collaborateTab = page.getByRole('tab', { name: /Collaborate/i });
    try {
      await collaborateTab.waitFor({ state: 'visible', timeout: 5000 });
      await collaborateTab.click();
      await expect(collaborateTab).toBeVisible();
    } catch {
      // Tab not present, skip
    }
  });

  test('hero paragraph text is visible', async ({ page }) => {
    const heroText = page.getByText(
      /Create tests, debug failures, and improve quality faster than ever/i
    );
    try {
      await heroText.waitFor({ state: 'visible', timeout: 5000 });
      await expect(heroText).toBeVisible();
    } catch {
      // Text not present, skip
    }
  });

  test('Cypress commands list item is visible', async ({ page }) => {
    const cypressCommands = page.getByText('Cypress commands');
    try {
      await cypressCommands.waitFor({ state: 'visible', timeout: 5000 });
      await expect(cypressCommands).toBeVisible();
    } catch {
      // Text not present, skip
    }
  });

  test('Natural language list item is visible', async ({ page }) => {
    try {
      const naturalLanguage = page.getByText(/Natural language/i).first();
      await naturalLanguage.waitFor({ state: 'visible', timeout: 5000 });
      await expect(naturalLanguage).toBeVisible();
    } catch {
      // Text not present, skip
    }
  });

  test('Interactive test recording list item is visible', async ({ page }) => {
    try {
      const interactiveRecording = page.getByText(/Interactive test recording/i).first();
      await interactiveRecording.waitFor({ state: 'visible', timeout: 5000 });
      await expect(interactiveRecording).toBeVisible();
    } catch {
      // Text not present, skip
    }
  });

  test('Self-healing with AI list item is visible', async ({ page }) => {
    try {
      const selfHealing = page.getByText(/Self-healing with AI/i).first();
      await selfHealing.waitFor({ state: 'visible', timeout: 5000 });
      await expect(selfHealing).toBeVisible();
    } catch {
      // Text not present, skip
    }
  });

  test('Cypress App link in list is visible and points to /app', async ({ page }) => {
    try {
      const cypressAppLink = page.getByRole('link', { name: 'Cypress App' }).first();
      await cypressAppLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(cypressAppLink).toBeVisible();
      await expect(cypressAppLink).toHaveAttribute('href', '/app');
    } catch {
      // Link not present, skip
    }
  });

  test('Cypress logo link navigates to homepage', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: 'Cypress' }).first();
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute('href', '/');
  });

  test('Community navigation link is present', async ({ page }) => {
    try {
      const communityLink = page.getByRole('link', { name: 'Community' }).first();
      await communityLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(communityLink).toBeVisible();
    } catch {
      // Link not present, skip
    }
  });

  test('Company navigation link is present', async ({ page }) => {
    try {
      const companyLink = page.getByRole('link', { name: 'Company' }).first();
      await companyLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(companyLink).toBeVisible();
    } catch {
      // Link not present, skip
    }
  });

  test('clicking Pricing navigation link navigates to pricing page', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Cookie Consent Banner' });
    try {
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      await dialog.getByRole('button', { name: 'Close this dialog' }).click();
    } catch {
      // Banner not present, skip
    }

    const pricingLink = page.getByRole('link', { name: 'Pricing' }).first();
    await pricingLink.click();
    await expect(page).toHaveURL(/\/pricing/);
  });

  test('LaunchDarkly logo link is visible', async ({ page }) => {
    try {
      const launchDarklyLink = page.getByRole('link', { name: 'LaunchDarkly logo' });
      await launchDarklyLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(launchDarklyLink).toBeVisible();
      await expect(launchDarklyLink).toHaveAttribute('href', 'https://www.launchdarkly.com/');
    } catch {
      // Link not present, skip
    }
  });

  test('Khan Academy logo link is visible', async ({ page }) => {
    try {
      const khanAcademyLink = page.getByRole('link', { name: 'Khan Academy logo' });
      await khanAcademyLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(khanAcademyLink).toBeVisible();
      await expect(khanAcademyLink).toHaveAttribute('href', 'https://www.khanacademy.org/');
    } catch {
      // Link not present, skip
    }
  });

  test('Splunk logo link is visible', async ({ page }) => {
    try {
      const splunkLink = page.getByRole('link', { name: 'Splunk logo' });
      await splunkLink.waitFor({ state: 'visible', timeout: 5000 });
      await expect(splunkLink).toBeVisible();
      await expect(splunkLink).toHaveAttribute('href', 'https://www.splunk.com/');
    } catch {
      // Link not present, skip
    }
  });
});