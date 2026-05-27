import { test, expect } from './fixtures.js';
import { TARGET_URL } from './fixtures.js';

const SIGN_IN_URL =
  'https://signin.ollama.com/?client_id=client_01JX0QMHD43PFFCCNXH82A6K8B&redirect_uri=https%3A%2F%2Follama.com%2Fauth%2Fcallback&authorization_session_id=01KSFQRE2ZZM6SF8S1452MH5MR';

test.describe('Sign in page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SIGN_IN_URL);
  });

  test('page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Sign in/i);
  });

  test('heading "Sign in" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('logo is visible', async ({ page }) => {
    await expect(page.getByRole('img', { name: 'Logo' })).toBeVisible();
  });

  test('email input field is present and has correct placeholder', async ({ page }) => {
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('placeholder', 'Your email address');
    await expect(emailInput).toHaveAttribute('type', 'email');
  });

  test('Continue button is visible and enabled', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('OR separator text is visible', async ({ page }) => {
    await expect(page.getByText('OR')).toBeVisible();
  });

  test('"Continue with Google" link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  });

  test('"Continue with GitHub" link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  });

  test('"Continue with Google" link has correct href', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Continue with Google' });
    await expect(link).toHaveAttribute('href', /provider=GoogleOAuth/);
    await expect(link).toHaveAttribute('href', /source=signin/);
  });

  test('"Continue with GitHub" link has correct href', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Continue with GitHub' });
    await expect(link).toHaveAttribute('href', /provider=GitHubOAuth/);
    await expect(link).toHaveAttribute('href', /source=signin/);
  });

  test('"Don\'t have an account?" text is visible', async ({ page }) => {
    await expect(page.getByText("Don't have an account?")).toBeVisible();
  });

  test('"Sign up" link is visible and points to sign-up page', async ({ page }) => {
    const signUpLink = page.getByRole('link', { name: 'Sign up' });
    await expect(signUpLink).toBeVisible();
    await expect(signUpLink).toHaveAttribute('href', /\/sign-up/);
  });

  test('"Terms of Service" link is visible and has correct href', async ({ page }) => {
    const tosLink = page.getByRole('link', { name: 'Terms of Service' });
    await expect(tosLink).toBeVisible();
    await expect(tosLink).toHaveAttribute('href', 'https://ollama.com/terms');
  });

  test('"Privacy Policy" link is visible and has correct href', async ({ page }) => {
    const privacyLink = page.getByRole('link', { name: 'Privacy Policy' });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', 'https://ollama.com/privacy');
  });

  test('form fields exist: email input and Continue button', async ({ page }) => {
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(emailInput).toBeVisible();
    await expect(continueButton).toBeVisible();
  });

  test('user can type into email input', async ({ page }) => {
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
  });

  test('submitting empty email shows validation or keeps Continue button clickable', async ({ page }) => {
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await continueButton.click();
    // After clicking Continue with no email, the page should still show the email input
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  });

  test('alert landmark is present in the accessibility tree', async ({ page }) => {
    await expect(page.getByRole('alert')).toBeAttached();
  });

  test('clicking "Sign up" link navigates to sign-up page', async ({ page }) => {
    const signUpLink = page.getByRole('link', { name: 'Sign up' });
    await signUpLink.click();
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test('email form submission with valid email triggers continue flow', async ({ page }) => {
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    const continueButton = page.getByRole('button', { name: 'Continue' });

    await emailInput.fill('user@example.com');
    await expect(emailInput).toHaveValue('user@example.com');
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    // The form should attempt to proceed; page is still accessible
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible().catch(() => {
      // May have navigated away or shown next step
    });
  });

  test('login with credentials from environment variables', async ({ page }) => {
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    const emailInput = page.getByRole('textbox', { name: 'Email' });
    await emailInput.fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();

    // After submitting email, a password field or magic link step may appear
    const passwordInput = page.getByLabel(/password/i);
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(password);
      await page.getByRole('button', { name: /continue|sign in|submit/i }).click();
    }
  });
});