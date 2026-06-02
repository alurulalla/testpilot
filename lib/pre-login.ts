/**
 * Pre-login helper — works across a wide range of site patterns.
 *
 * Strategy:
 *  1. Navigate to the URL (or auto-discover a login page if the root has no form)
 *  2. Dismiss cookie consent banners
 *  3. Fill form fields using smart multi-selector matching
 *  4. Submit (tries submit button first, then Enter)
 *  5. Detect success by URL change OR DOM change (handles SPAs)
 *  6. Save Playwright storage state to auth.json
 *
 * Returns the post-login URL so the site explorer can start from the
 * authenticated landing page.
 */
import { chromium, Page } from 'playwright';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { ContextField } from './url-context-store';

export interface LoginPageInfo {
  /** URL of the login page (after auto-discovery) */
  url: string;
  /** Exact CSS selector that was used to fill the username/email field */
  usernameSelector: string;
  /** Submit button text found on the page, if detectable */
  submitButtonText: string;
}

export interface PreLoginResult {
  success: boolean;
  postLoginUrl: string;
  authFile: string;
  error?: string;
  /** Details about the login form — used to generate accurate login() helpers */
  loginPageInfo?: LoginPageInfo;
}

// ── Cookie consent dismissal ──────────────────────────────────────────────────

const CONSENT_SELECTORS = [
  // Generic accept/close buttons (text-based)
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept cookies")',
  'button:has-text("Accept")',
  'button:has-text("Agree")',
  'button:has-text("I agree")',
  'button:has-text("Allow all")',
  'button:has-text("OK")',
  'button:has-text("Close")',
  // ID/class patterns common across consent platforms
  '#onetrust-accept-btn-handler',
  '.cc-allow',
  '[aria-label*="Accept" i]',
  '[aria-label*="cookie" i]',
];

async function dismissCookieConsent(page: Page): Promise<void> {
  for (const sel of CONSENT_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        return;
      }
    } catch { /* continue */ }
  }
}

// ── Login page discovery ──────────────────────────────────────────────────────

const LOGIN_PATH_PATTERNS = [
  '/login', '/signin', '/sign-in', '/log-in', '/auth', '/auth/login',
  '/user/login', '/users/sign_in', '/account/login', '/session/new',
  '/wp-login.php', '/admin', '/en/login', '/fr/login',
];

/**
 * Check if the current page has a password input (i.e. is a login form).
 * If not, try common login path patterns until we find one.
 */
async function findLoginPage(page: Page, baseUrl: string, log: (msg: string) => void): Promise<void> {
  const hasPasswordField = await page
    .locator('input[type="password"]')
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (hasPasswordField) return; // already on the login page

  log('  No login form on root page — searching for login path…');
  const origin = new URL(baseUrl).origin;

  for (const p of LOGIN_PATH_PATTERNS) {
    const candidate = origin + p;
    try {
      const res = await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 8_000 });
      if (res && res.status() < 400) {
        const found = await page.locator('input[type="password"]').isVisible({ timeout: 1500 }).catch(() => false);
        if (found) {
          log(`  ✓ Login form found at ${candidate}`);
          return;
        }
      }
    } catch { /* try next */ }
  }

  // Fall back to root — we'll try to fill what we can
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 20_000 });
  log('  ⚠ Could not find a dedicated login page — using root URL');
}

// ── Field matching ────────────────────────────────────────────────────────────

function selectorsFor(field: ContextField): string[] {
  const key = field.key;
  const label = field.label.toLowerCase();
  const type = field.type;
  const candidates: string[] = [];

  // Exact name / id match
  if (key) {
    candidates.push(`input[name="${key}"]`);
    candidates.push(`input[id="${key}"]`);
    candidates.push(`textarea[name="${key}"]`);
  }

  // Type-based
  if (type === 'password') {
    candidates.push('input[type="password"]');
  }
  if (type === 'email') {
    candidates.push('input[type="email"]');
  }

  // Keyword heuristics — covers username / email / user_name / etc.
  const isUser = /user|login|account|email|mail/.test(label + ' ' + key);
  const isPass = /pass|secret|pin|credential/.test(label + ' ' + key);

  if (isUser && type !== 'password') {
    candidates.push('input[name*="user" i]', 'input[id*="user" i]',
      'input[name*="email" i]', 'input[id*="email" i]',
      'input[name*="login" i]', 'input[id*="login" i]',
      'input[placeholder*="user" i]', 'input[placeholder*="email" i]',
      // First visible text/email input as last resort
      'input[type="text"]:visible', 'input[type="email"]:visible',
    );
  }
  if (isPass || type === 'password') {
    candidates.push('input[type="password"]');
  }

  if (field.label) {
    candidates.push(`input[placeholder*="${field.label}" i]`);
    candidates.push(`input[aria-label*="${field.label}" i]`);
  }

  return [...new Set(candidates)];
}

// ── Submit detection ──────────────────────────────────────────────────────────

// Broad list — covers most languages and patterns
const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  // English
  'button:has-text("Login")', 'button:has-text("Log in")', 'button:has-text("Log In")',
  'button:has-text("Sign in")', 'button:has-text("Sign In")',
  'button:has-text("Continue")', 'button:has-text("Next")',
  // German
  'button:has-text("Anmelden")', 'button:has-text("Einloggen")',
  // French
  'button:has-text("Connexion")', 'button:has-text("Se connecter")',
  // Spanish
  'button:has-text("Iniciar sesión")', 'button:has-text("Entrar")',
  // aria/role
  '[role="button"]:has-text("Login")', '[role="button"]:has-text("Sign in")',
  // Generic: any button inside a form that has a password field
  'form:has(input[type="password"]) button',
  'form:has(input[type="password"]) [type="submit"]',
];

// ── URL normalisation ─────────────────────────────────────────────────────────

/**
 * Strip everything that can change between page loads without a real navigation:
 *  - ;jsessionid=… path parameter (Java servlet sessions)
 *  - query string (error codes, nonces, CSRF tokens)
 *  - hash fragment
 * This gives us a stable "logical page URL" for comparison.
 */
function normalizeUrlForComparison(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/;[^/?#]*/g, ''); // strip ;jsessionid=… and similar
    return u.origin + path;
  } catch {
    return url.split('?')[0].split('#')[0].replace(/;[^/?#]*/g, '');
  }
}

// ── Post-login success detection ──────────────────────────────────────────────

/**
 * Wait up to timeoutMs for either:
 *  • A URL path change (redirect-based login), OR
 *  • A significant DOM change (SPA login: same URL but page content changes)
 *
 * We compare *normalised* URLs so that jsessionid rotation or error query
 * params on a failed login don't trick us into thinking we navigated away.
 *
 * Returns the final URL.
 */
async function waitForLoginSuccess(page: Page, beforeUrl: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const beforeNorm = normalizeUrlForComparison(beforeUrl);

  // Capture a DOM fingerprint before submit (count of top-level elements)
  const beforeFingerprint = await page.evaluate(() =>
    document.body?.children.length ?? 0,
  ).catch(() => 0);

  while (Date.now() < deadline) {
    await page.waitForTimeout(400);

    const currentUrl = page.url();
    const currentNorm = normalizeUrlForComparison(currentUrl);

    // Normalised URL path changed → real navigation (redirect-based login)
    if (currentNorm !== beforeNorm && !currentUrl.endsWith('#')) {
      return currentUrl;
    }

    // DOM changed significantly → SPA login (same URL, new content)
    const afterFingerprint = await page.evaluate(() =>
      document.body?.children.length ?? 0,
    ).catch(() => 0);

    if (Math.abs(afterFingerprint - beforeFingerprint) > 2) {
      // Wait a tick for the page to settle
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return page.url();
    }
  }

  return page.url(); // timed out — return whatever URL we're on
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function performPreLogin(
  url: string,
  fields: ContextField[],
  workspaceDir: string,
  onProgress?: (msg: string) => void,
): Promise<PreLoginResult> {
  const log = (msg: string) => onProgress?.(msg);
  mkdirSync(workspaceDir, { recursive: true });
  const authFile = path.join(workspaceDir, 'auth.json');

  const fieldsWithValues = fields.filter(f => f.value);
  if (fieldsWithValues.length === 0) {
    return { success: false, postLoginUrl: url, authFile, error: 'No context values provided' };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      // Accept most language/encoding headers to avoid bot detection
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    log(`Navigating to ${url}…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(800); // brief settle for JS-rendered forms

    // Dismiss cookie banners that might block the form
    await dismissCookieConsent(page);

    // Find the login page (auto-navigates if root has no password field)
    await findLoginPage(page, url, log);

    const loginPageUrl = page.url();

    // Fill fields — track which selector matched the username field
    let filledCount = 0;
    let usernameSelector = '';
    for (const field of fieldsWithValues) {
      const selectors = selectorsFor(field);
      let filled = false;
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
            await el.click({ timeout: 1000 }).catch(() => {});
            await el.fill(field.value);
            filledCount++;
            log(`  ✓ Filled "${field.label || field.key}"`);
            // Track the username selector (first non-password field that matched)
            if (!usernameSelector && field.type !== 'password') {
              usernameSelector = sel;
            }
            filled = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!filled) {
        log(`  ⚠ No input found for "${field.label || field.key}" — skipping`);
      }
    }

    if (filledCount === 0) {
      await ctx.close();
      return {
        success: false,
        postLoginUrl: url,
        authFile,
        error: 'No form fields could be filled. The page may require JavaScript rendering or have an unusual form structure.',
      };
    }

    // Submit — also capture the submit button's visible text for the login helper
    const beforeUrl = page.url();
    let submitted = false;
    let submitButtonText = 'Log in';
    for (const sel of SUBMIT_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
          // Capture accessible text before clicking
          const btnText = (await btn.innerText().catch(() => '')) || (await btn.getAttribute('value').catch(() => '')) || '';
          if (btnText.trim()) submitButtonText = btnText.trim();
          await btn.click({ timeout: 2000 });
          submitted = true;
          log(`  ✓ Clicked submit ("${submitButtonText}")`);
          break;
        }
      } catch { /* try next */ }
    }
    if (!submitted) {
      log('  ↵ Pressing Enter to submit');
      await page.keyboard.press('Enter');
    }

    // Wait for login to complete (handles both redirect and SPA)
    const postLoginUrl = await waitForLoginSuccess(page, beforeUrl);

    // Detect failure: still on the login page or an obvious error visible.
    // Compare normalised URLs so jsessionid rotation on failed logins doesn't
    // fool us into thinking a redirect happened.
    const stillOnLoginPage =
      normalizeUrlForComparison(postLoginUrl) === normalizeUrlForComparison(loginPageUrl);

    if (stillOnLoginPage) {
      const errText = await page.evaluate(() => {
        const candidates = [
          '[class*="error" i]', '[class*="alert" i]',
          '[role="alert"]', '[data-testid*="error" i]',
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el) return el.textContent?.trim() ?? '';
        }
        return '';
      });
      await ctx.close();
      return {
        success: false,
        postLoginUrl: url,
        authFile,
        error: errText
          ? `Login failed — page says: "${errText}"`
          : 'Login did not succeed (URL unchanged and no redirect detected). Check your credentials.',
      };
    }

    log(`  ✓ Login successful → ${postLoginUrl}`);
    await ctx.storageState({ path: authFile });
    log(`  ✓ Auth state saved`);
    await ctx.close();
    return {
      success: true,
      postLoginUrl,
      authFile,
      loginPageInfo: {
        url: loginPageUrl,
        usernameSelector: usernameSelector || 'input[type="text"]',
        submitButtonText,
      },
    };
  } finally {
    await browser.close();
  }
}

// ── Playwright config patching ────────────────────────────────────────────────

export function patchPlaywrightConfigForAuth(workspaceDir: string): void {
  const configPath = path.join(workspaceDir, 'playwright.config.ts');
  const authPath = path.join(workspaceDir, 'auth.json');
  if (!existsSync(configPath) || !existsSync(authPath)) return;
  try {
    let content = readFileSync(configPath, 'utf8');
    if (content.includes('storageState')) return;
    content = content.replace(
      /(\buse\s*:\s*\{)/,
      "$1\n    storageState: './auth.json',",
    );
    writeFileSync(configPath, content, 'utf8');
  } catch { /* non-fatal */ }
}
