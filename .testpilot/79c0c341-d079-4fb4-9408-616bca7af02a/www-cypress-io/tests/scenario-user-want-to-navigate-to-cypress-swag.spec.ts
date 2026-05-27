import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test('user can navigate to cypress swag page', async ({ page }) => {
  await page.goto('https://www.cypress.io/#create');

  await expect(page).toHaveTitle(/Testing Frameworks for Javascript|Cypress/i);

  await expect(
    page.getByRole('heading', { name: /Browser testing for modern teams/i })
  ).toBeVisible();

  const swagLink = page.getByRole('link', { name: /swag/i });

  if (await swagLink.count() > 0) {
    await swagLink.first().click();
    await expect(page).toHaveURL(/swag/i);
  } else {
    const footerLinks = page.getByRole('link');
    const allLinks = await footerLinks.allTextContents();
    const swagText = allLinks.find(text => /swag/i.test(text));

    if (swagText) {
      await page.getByRole('link', { name: new RegExp(swagText, 'i') }).first().click();
      await expect(page).toHaveURL(/swag/i);
    } else {
      await page.goto('https://www.cypress.io/swag');
      await expect(page).toHaveURL(/swag/i);
    }
  }
});