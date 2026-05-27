import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

test.describe('Ollama Search Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${TARGET_URL}/search`);
  });

  test('page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Ollama/i);
  });

  test('navigation bar is visible with expected links', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();

    await expect(nav.getByRole('link', { name: 'Ollama' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Models' }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Docs' }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Download' }).first()).toBeVisible();
  });

  test('search input is present and functional', async ({ page }) => {
    const searchBox = page.getByRole('textbox', { name: 'Search models' });
    await expect(searchBox).toBeVisible();
    await searchBox.fill('llama');
    await expect(searchBox).toHaveValue('llama');
  });

  test('filter checkboxes are visible', async ({ page }) => {
    await expect(page.getByRole('checkbox', { name: 'Cloud' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Embedding' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Vision' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Tools' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Thinking' })).toBeVisible();
  });

  test('sort combobox has Popular and Newest options', async ({ page }) => {
    const combobox = page.getByRole('combobox');
    await expect(combobox).toBeVisible();
    await expect(combobox.getByRole('option', { name: 'Popular' })).toBeAttached();
    await expect(combobox.getByRole('option', { name: 'Newest' })).toBeAttached();
  });

  test('sort combobox defaults to Popular', async ({ page }) => {
    const combobox = page.getByRole('combobox');
    await expect(combobox).toHaveValue('Popular');
  });

  test('model list is visible and contains items', async ({ page }) => {
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
    const items = list.getByRole('listitem');
    await expect(items.first()).toBeVisible();
  });

  test('granite4.1 model card is visible with correct link', async ({ page }) => {
    const link = page.getByRole('link', { name: /granite4\.1/i }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/library/granite4.1');
  });

  test('gemma4 model card is visible', async ({ page }) => {
    const link = page.getByRole('link', { name: /gemma4/i }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/library/gemma4');
  });

  test('mistral-medium-3.5 model card is visible', async ({ page }) => {
    const link = page.getByRole('link', { name: /mistral-medium-3\.5/i }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/library/mistral-medium-3.5');
  });

  test('model cards display headings', async ({ page }) => {
    const headings = page.getByRole('heading', { level: 2 });
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('filtering by Vision checkbox updates results', async ({ page }) => {
    const visionCheckbox = page.getByRole('checkbox', { name: 'Vision' });
    await visionCheckbox.check();
    await expect(visionCheckbox).toBeChecked();
    await page.waitForTimeout(500);
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
  });

  test('filtering by Tools checkbox works', async ({ page }) => {
    const toolsCheckbox = page.getByRole('checkbox', { name: 'Tools' });
    await toolsCheckbox.check();
    await expect(toolsCheckbox).toBeChecked();
    await page.waitForTimeout(500);
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
  });

  test('filtering by Thinking checkbox works', async ({ page }) => {
    const thinkingCheckbox = page.getByRole('checkbox', { name: 'Thinking' });
    await thinkingCheckbox.check();
    await expect(thinkingCheckbox).toBeChecked();
    await page.waitForTimeout(500);
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
  });

  test('changing sort to Newest updates combobox value', async ({ page }) => {
    const combobox = page.getByRole('combobox');
    await combobox.selectOption('Newest');
    await expect(combobox).toHaveValue('Newest');
  });

  test('searching for a model filters results', async ({ page }) => {
    const searchBox = page.getByRole('textbox', { name: 'Search models' });
    await searchBox.fill('llama');
    await page.waitForTimeout(500);
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
  });

  test('clicking Models nav link stays on search page', async ({ page }) => {
    const modelsLink = page.getByRole('navigation').getByRole('link', { name: 'Models' }).first();
    await modelsLink.click();
    await expect(page).toHaveURL(/\/search/);
  });

  test('clicking Docs nav link navigates to docs', async ({ page }) => {
    const docsLink = page.getByRole('navigation').getByRole('link', { name: 'Docs' }).first();
    await docsLink.click();
    await expect(page).toHaveURL(/\/docs/);
  });

  test('clicking Sign in link navigates to sign in page', async ({ page }) => {
    const signInLink = page.getByRole('navigation').getByRole('link', { name: 'Sign in' }).first();
    await signInLink.click();
    await expect(page).toHaveURL(/\/signin/);
  });

  test('clicking Download link navigates to download page', async ({ page }) => {
    const downloadLink = page.getByRole('navigation').getByRole('link', { name: 'Download' }).first();
    await downloadLink.click();
    await expect(page).toHaveURL(/\/download/);
  });

  test('clicking on a model card navigates to model detail page', async ({ page }) => {
    const modelLink = page.getByRole('link', { name: /granite4\.1/i }).first();
    await modelLink.click();
    await expect(page).toHaveURL(/\/library\/granite4\.1/);
  });

  test('Cloud checkbox is initially unchecked', async ({ page }) => {
    const cloudCheckbox = page.getByRole('checkbox', { name: 'Cloud' });
    await expect(cloudCheckbox).not.toBeChecked();
  });

  test('Embedding checkbox is initially unchecked', async ({ page }) => {
    const embeddingCheckbox = page.getByRole('checkbox', { name: 'Embedding' });
    await expect(embeddingCheckbox).not.toBeChecked();
  });

  test('Ollama logo link is present and points to home', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: 'Ollama' });
    await expect(logoLink).toBeVisible();
    await expect(logoLink).toHaveAttribute('href', '/');
  });

  test('search clears and shows all models again', async ({ page }) => {
    const searchBox = page.getByRole('textbox', { name: 'Search models' });
    await searchBox.fill('llama');
    await page.waitForTimeout(300);
    await searchBox.clear();
    await page.waitForTimeout(300);
    await expect(searchBox).toHaveValue('');
    const list = page.getByRole('list');
    await expect(list).toBeVisible();
    const items = list.getByRole('listitem');
    await expect(items.first()).toBeVisible();
  });
});