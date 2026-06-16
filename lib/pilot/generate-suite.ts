/**
 * Test suite generator — reads site_map.json and writes one Playwright
 * spec file per page using Claude.
 *
 * Improvements over the original npm-based crawler:
 *  - Reads CONTEXT.md from the workspace directory (written by the loop
 *    route when the user has provided URL context / credentials) and
 *    injects it into the system prompt so Claude generates tests that
 *    actually use the stored environment variables.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ChatModel, ChatMessage } from './types';
import type { Workspace } from './workspace';
import { renderFeatureChecklist, type DiscoveredFeature } from '@/lib/synthesize-features';

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract TypeScript code from an LLM response.
 *
 * LLMs sometimes emit reasoning prose before the code.  We handle four cases
 * in priority order:
 *  1. Fenced ```typescript / ```ts / ``` block → extract its content.
 *  2. Prose preamble before first `import` statement → strip the prose.
 *  3. Response starts directly with `import` → return as-is.
 *  4. Fallback → return raw trimmed text (caller validates it).
 */
function extractTypeScript(raw: string): string {
  const trimmed = raw.trim();

  // 1. Fenced code block
  const fenceMatch = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Prose before first import — strip it
  const importIdx = trimmed.indexOf('\nimport ');
  if (importIdx >= 0) return trimmed.slice(importIdx + 1).trim();

  // 3. Starts directly with import
  if (trimmed.startsWith('import ')) return trimmed;

  // 4. Fallback — return as-is; caller checks for test() presence
  return trimmed;
}

/**
 * Ensure every generated spec file has the correct imports for `test`,
 * `expect`, and `TARGET_URL`.  The LLM sometimes omits `test` from the
 * import list or imports it from `@playwright/test` instead of
 * `./fixtures.js`, which causes a runtime ReferenceError.
 *
 * This sanitizer is intentionally dumb and deterministic — no LLM call.
 */
function sanitizeImports(content: string): string {
  const hasTestUsage =
    /\btest\s*\(/.test(content) || /\btest\.describe\s*\(/.test(content);

  // Already importing test from our fixtures → nothing to do
  const hasFixturesTestImport =
    /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(content);

  if (!hasTestUsage || hasFixturesTestImport) return content;

  // Remove any import of test/expect from @playwright/test (wrong source)
  let fixed = content
    .replace(/^import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '')
    .replace(/^import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '');

  // Prepend the canonical fixtures imports
  const canonical =
    `import { test, expect } from './fixtures.js';\n` +
    `import { TARGET_URL } from './fixtures.js';\n`;

  // Avoid double-importing TARGET_URL if it's already present
  const hasTargetUrlImport =
    /import\s*\{[^}]*TARGET_URL[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(fixed);

  fixed = (hasTargetUrlImport
    ? `import { test, expect } from './fixtures.js';\n`
    : canonical) + fixed;

  return fixed;
}

/** Convert a documentation feature name to a safe file-name slug. */
function featureNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'feature';
}

/** Convert a page URL to a safe file-name stem. */
function urlToFileName(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    const base   = new URL(baseUrl);
    let pathname = parsed.pathname.replace(base.pathname, '');
    if (!pathname || pathname === '/') return 'homepage';
    pathname = pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathname.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'page';
  } catch {
    return 'page';
  }
}

/** Read CONTEXT.md from the workspace if it exists — contains credentials hint. */
function readContextMd(workspaceDir: string): string | null {
  const contextPath = path.join(workspaceDir, 'CONTEXT.md');
  if (!existsSync(contextPath)) return null;
  try {
    return readFileSync(contextPath, 'utf8').trim();
  } catch {
    return null;
  }
}

// ── Prompt builders ───────────────────────────────────────────────────────────

interface LoginInfo {
  loginUrl: string;
  usernameSelector: string;
  submitButtonText: string;
  usernameEnvVar: string;
  usernameValue: string;
  passwordEnvVar: string;
  passwordValue: string;
}

function buildFixturesFile(baseUrl: string, loginInfo?: LoginInfo): string {
  const loginHelper = loginInfo
    ? `
import { Page } from '@playwright/test';

const LOGIN_URL = ${JSON.stringify(loginInfo.loginUrl)};

/**
 * Log in using stored credentials.
 * Uses the exact selectors captured when the login form was detected.
 */
export async function login(page: Page): Promise<void> {
  const username = process.env.${loginInfo.usernameEnvVar} ?? ${JSON.stringify(loginInfo.usernameValue)};
  const password = process.env.${loginInfo.passwordEnvVar} ?? ${JSON.stringify(loginInfo.passwordValue)};
  if (!username || !password) {
    throw new Error(
      'login(): no credentials configured. Set ${loginInfo.usernameEnvVar} / ${loginInfo.passwordEnvVar} ' +
      'in .env (or the environment) and re-run.',
    );
  }

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // Username field must be present — otherwise the selector/login URL is wrong
  // and every downstream test would fail with a cryptic timeout.
  const userField = page.locator(${JSON.stringify(loginInfo.usernameSelector)}).first();
  try {
    await userField.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error('login(): username field not found at ' + LOGIN_URL + ' — the login form may have changed.');
  }
  await userField.fill(username);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"], input[type="submit"]')
    .or(page.getByRole('button', { name: ${JSON.stringify(loginInfo.submitButtonText)} }))
    .first()
    .click();

  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  // Verify login actually succeeded: the password field should no longer be
  // visible on the same login URL. If it is, credentials/selectors are wrong —
  // fail LOUDLY here instead of letting tests fail with an opaque error later.
  let loginPath = '';
  try { loginPath = new URL(LOGIN_URL).pathname; } catch { /* ignore */ }
  const stillOnLoginUrl = (() => {
    try { return new URL(page.url()).pathname === loginPath; } catch { return false; }
  })();
  const passwordStillVisible = await page.locator('input[type="password"]').first()
    .isVisible().catch(() => false);
  if (stillOnLoginUrl && passwordStillVisible) {
    throw new Error(
      'login(): still on the login page after submitting — login did not succeed. ' +
      'Check the credentials and the captured selectors.',
    );
  }
}
`
    : '';

  return `import { test as base } from '@playwright/test';
${loginHelper}
export const TARGET_URL = ${JSON.stringify(baseUrl)};

// Cookie / privacy consent banners (OneTrust, Cookiebot, and generic "Accept"
// dialogs) sit on top of the page and intercept clicks or hide content, which
// silently fails most interaction and visibility checks. addLocatorHandler runs
// automatically whenever such a banner appears — before any action — and clicks
// it away, so individual tests never have to deal with it. Multilingual
// (incl. German) because sites localise the button label.
async function armConsentDismissal(page: import('@playwright/test').Page) {
  const accept = page
    .getByRole('button', {
      name: /^(accept all|accept|allow all|allow|agree|i agree|i accept|got it|ok|okay|akzeptieren|alle akzeptieren|zustimmen|einverstanden|tout accepter|accepter)/i,
    })
    .first();
  await page.addLocatorHandler(accept, async () => {
    await accept.click({ timeout: 2000 }).catch(() => {});
  }).catch(() => {});

  // Known consent frameworks by their stable element ids (more reliable than text).
  const byId = page.locator(
    '#onetrust-accept-btn-handler, ' +
    '#CybotCookiebotDialogBodyButtonAccept, ' +
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, ' +
    '[aria-label="Accept all"], [data-testid="uc-accept-all-button"]',
  ).first();
  await page.addLocatorHandler(byId, async () => {
    await byId.click({ timeout: 2000 }).catch(() => {});
  }).catch(() => {});
}

export const test = base.extend<{ targetUrl: string }>({
  page: async ({ page }, use) => {
    await armConsentDismissal(page);
    await use(page);
  },
  targetUrl: async ({}, use) => {
    await use(TARGET_URL);
  },
});

export { expect } from '@playwright/test';
`;
}

interface PageData {
  url: string;
  title: string;
  elements: Record<string, unknown>;
  accessibility_tree?: unknown;
}

interface Interactive {
  role: string; name: string; id: string; testId: string; href?: string;
  /** Crawl-time uniqueness: role+name repeats on the page (header/footer copies). */
  dupe?: boolean;
  /** This element's index among the same-role+name matches (when `dupe`). */
  nth?: number;
  /** The href appears on more than one element (so a[href] is ambiguous too). */
  hrefDupe?: boolean;
}

// ── Emoji helpers ─────────────────────────────────────────────────────────────
// Emoji characters in accessible names make `getByRole(role, { name: 'exact' })`
// brittle — browsers and Playwright may or may not include the emoji in the
// computed accessible name.  We strip them from the displayed name in the
// interactives table and tell the LLM to use a regex instead.

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]/gu;

function hasEmoji(str: string): boolean {
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(str);
}

function stripEmoji(str: string): string {
  return str.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Format the `interactives` array into a concise locator-reference table.
 *
 * Names that contain emoji are shown stripped of their emoji and marked with
 * `(use /regex/)` so the LLM knows to write `getByRole(role, { name: /text/i })`
 * instead of an exact string match, which is fragile against emoji variance.
 */
function formatInteractives(elements: Record<string, unknown>, maxItems = 80): string {
  const items = (elements.interactives as Interactive[] | undefined) ?? [];
  if (items.length === 0) return '';

  const lines = items.slice(0, maxItems).map(el => {
    const nameHasEmoji = hasEmoji(el.name);
    const displayName  = nameHasEmoji ? stripEmoji(el.name) : el.name;

    // Links with a meaningful href get a direct locator hint — more reliable
    // than any text or regex match, completely immune to emoji/wording changes.
    const isNavLink = el.role === 'link' && el.href &&
      !el.href.startsWith('javascript:') && !el.href.startsWith('mailto:') &&
      !el.href.startsWith('tel:') && el.href !== '#';

    let hint = '';
    if (isNavLink) {
      // If the same href appears more than once (typically header + footer), the
      // a[href] locator matches >1 element → strict-mode failure. Pin it.
      const sel = `locator('a[href="${el.href}"]')${el.hrefDupe ? '.first()' : ''}`;
      hint = `  href="${el.href}"  ← prefer: ${sel}`;
    } else if (el.dupe) {
      // role+name repeats on the page → getByRole would be ambiguous. Pin to the
      // exact one we saw, by index.
      hint = `  ← DUPLICATE name: use getByRole('${el.role}', { name: '${displayName}' }).nth(${el.nth ?? 0})`;
    } else if (nameHasEmoji) {
      hint = '  ← use /regex/';
    }

    let line = `  ${el.role.padEnd(12)} "${displayName}"${hint}`;
    if (!isNavLink && el.id)     line += `  id="${el.id}"`;
    if (!isNavLink && el.testId) line += `  data-testid="${el.testId}"`;
    return line;
  });

  return (
    `\n┌─ INTERACTIVE ELEMENTS ──────────────────────────────────────────────────┐\n` +
    `│ role         accessible-name        href / hint / id / testid           │\n` +
    lines.join('\n') + '\n' +
    `└─────────────────────────────────────────────────────────────────────────┘\n`
  );
}

/** True when contextMd was written from an uploaded product documentation file. */
function detectsProductDoc(contextMd: string | null): boolean {
  return Boolean(contextMd?.includes('# Product Documentation'));
}

/** Extract feature sections from the product documentation portion of contextMd. */
function parseFeaturesFromDoc(contextMd: string): { name: string; items: string[] }[] {
  const sections: { name: string; items: string[] }[] = [];
  let cur: { name: string; items: string[] } | null = null;
  const SKIP = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction)/i;
  const STOP = /^#{1,4}\s+(Typical\s+User\s+Journey|Best Practices?|Summary|User Flows? to Test)/i;
  for (const raw of contextMd.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.match(STOP)) { if (cur && cur.items.length) sections.push(cur); cur = null; continue; }
    const hm = line.match(/^#{2,4}\s+(?:\d+[.)]\s+)?(.+)/);
    if (hm) {
      const name = hm[1].trim();
      if (!name.match(SKIP)) {
        if (cur && cur.items.length) sections.push(cur);
        cur = { name, items: [] };
      }
      continue;
    }
    const bm = line.match(/^[-*•]\s+(.+)/);
    if (bm && cur) cur.items.push(bm[1].trim());
  }
  if (cur && cur.items.length) sections.push(cur);
  return sections;
}

function buildSystemPrompt(contextMd: string | null, appContext?: string): string {
  const hasDoc = detectsProductDoc(contextMd);

  let prompt = 'You are an expert Playwright Test engineer (TypeScript). ';

  if (hasDoc) {
    prompt +=
      'Product documentation has been provided below. ' +
      'Your test coverage MUST be driven entirely by that documentation. ' +
      'The user message contains an INTERACTIVE ELEMENTS table with the role and accessible name ' +
      'of every visible element on the page — you MUST use those names verbatim. ' +
      'For example: table shows  link "Sign In"  → write  getByRole("link", { name: "Sign In" }). ' +
      'NEVER guess IDs or class names not in the crawled data. ';
  } else {
    prompt +=
      'Generate a focused test file for a single page. ' +
      'The user message contains an INTERACTIVE ELEMENTS table — use its exact role + name strings ' +
      'for every locator. Do not guess any selector not present in that table. ';
  }

  prompt +=
    'LINK RULE: If a row has  href="..."  ← prefer: locator(...)  hint, use that CSS locator: ' +
    'page.locator(\'a[href="/path"]\') — this is the most precise locator for navigation links. ' +
    'EMOJI RULE: If a row has "← use /regex/" hint, write getByRole(role, { name: /Name/i }). ' +
    'ANTI-HALLUCINATION: NEVER assert text, headings, statistics, or page sections that are ' +
    'not explicitly present in the INTERACTIVE ELEMENTS table or accessibility tree. ' +
    'Ignore any training-data knowledge about this site — only use the crawl data. ' +
    'Return ONLY the complete TypeScript file — no markdown fences, no explanation.';

  if (contextMd) {
    prompt += `\n\n${contextMd}`;
  }

  // App-context spine: bias coverage toward the app's real features/journeys and
  // their intended outcomes (when a profile has been built for this app).
  if (appContext) {
    prompt += `\n\n${appContext}\n` +
      'Use the APP CONTEXT to prioritise tests for the most CRITICAL features and to ' +
      'assert their expected outcomes — but only with selectors present in the crawl data.';
  }
  return prompt;
}

/**
 * Returns true if the crawled page appears to be in an authenticated state.
 * Checks both interactive element names (logout/profile indicators) and the
 * page URL (non-root paths like /inventory.html, /dashboard are typically post-login).
 */
function pageRequiresAuth(elements: Record<string, unknown>, pageUrl?: string): boolean {
  const ints = (elements.interactives as { name: string }[] | undefined) ?? [];
  const LOGOUT_RE    = /\b(logout|log\s*out|sign\s*out)\b/i;
  const HELLO_RE     = /\b(hello|welcome|hi)\s+\w+/i;
  const ACCOUNT_RE   = /\b(my\s+account|manage\s+account|profile)\b/i;
  const hasAuthElement = ints.some(el =>
    LOGOUT_RE.test(el.name) || HELLO_RE.test(el.name) || ACCOUNT_RE.test(el.name)
  );
  if (hasAuthElement) return true;

  // If the page URL is not a root/login page but a deep path, it's likely authenticated.
  // Common post-login paths: /inventory, /dashboard, /cart, /checkout, /account, /profile, /home
  if (pageUrl) {
    try {
      const pathname = new URL(pageUrl).pathname;
      const LOGIN_PATHS  = /^\/?$|\/login|\/signin|\/sign-in|\/auth|\/index\.html?$/i;
      // Match segment-exact keywords: /inventory, /inventory.html, /inventory/, but NOT /inventory-item
      const AUTHED_PATHS = /\/(inventory|dashboard|cart|checkout|account|profile|home|orders?|settings|admin)(\/|\.html?|$)/i;
      if (!LOGIN_PATHS.test(pathname) && AUTHED_PATHS.test(pathname)) return true;
    } catch { /* invalid URL — ignore */ }
  }

  return false;
}

function buildPageTestPrompt(
  page: PageData,
  baseUrl: string,
  hasProductDoc: boolean,
  featureChecklist = '',
): string {
  // Interactives table: the definitive locator reference (role + exact name).
  // This is the single source of selectors we send — the accessibility tree is
  // intentionally NOT included because it largely duplicates this table's
  // role+name data at ~4x the token cost.
  const interactivesTable = formatInteractives(page.elements);

  // Supporting element details (inputs, headings, forms — keep budget modest)
  const supportJson = JSON.stringify(
    { inputs: page.elements.inputs, headings: page.elements.headings, forms: page.elements.forms },
    null, 2,
  ).slice(0, 2_000);

  // Detect authenticated page — require login() call in every test
  const needsLogin = pageRequiresAuth(page.elements, page.url);
  const authRule = needsLogin
    ? `⚠ AUTH REQUIRED: This page was crawled in an AUTHENTICATED state (elements like "Logout" or ` +
      `"Hello admin!" are visible). Every single test in this file MUST call ` +
      `\`await login(page)\` (imported from './fixtures.js') BEFORE \`page.goto\`. ` +
      `Do NOT generate any test that navigates to this page without first calling login().\n`
    : '';

  const loginImport = needsLogin ? `- import { test, expect, login } from './fixtures.js'\n` : `- import { test, expect } from './fixtures.js'\n`;

  const coverageRules = hasProductDoc
    ? (
      `- Write a test for EVERY section and feature listed in the Product Documentation above\n` +
      `- Use the INTERACTIVE ELEMENTS table for every locator — no guessing\n`
    )
    : (
      `- Include: page loads, title/heading visible, key interactive elements present\n` +
      `- If the page has forms, verify the form fields exist and are fillable\n` +
      `- If the page has navigation links, verify at least one same-origin link\n`
    );

  return (
    `⛔ CRITICAL — ANTI-HALLUCINATION RULE:\n` +
    `You MUST ONLY write tests for elements and text that appear in the INTERACTIVE ELEMENTS ` +
    `table below. IGNORE any knowledge of this site from your training ` +
    `data. DO NOT invent headings, link text, page sections, statistics, or any other content. ` +
    `If the crawl data shows limited content, write fewer tests — never fabricate expected values.\n\n` +
    (authRule ? authRule + '\n' : '') +
    `Generate a Playwright test file for this page.\n` +
    `URL: ${page.url}\n` +
    `Title: ${page.title}\n` +
    `Base URL: ${baseUrl}\n\n` +
    interactivesTable +
    `── Supporting element details ──\n${supportJson}\n` +
    featureChecklist + `\n\n` +
    `LOCATOR RULES (strictly enforced):\n` +
    `- LINK RULE: if a row shows  href="..."  ← prefer: locator(...)  → use that CSS locator\n` +
    `  Example:  link "Employees"  href="/Employee"  → page.locator('a[href="/Employee"]')\n` +
    `  This is more precise than text matching and immune to emoji or wording changes.\n` +
    `- DUPLICATE RULE (strict mode): the interactives table marks elements whose name or href ` +
    `repeats on the page (e.g. a nav link that also appears in the footer). Playwright throws ` +
    `on a locator that matches >1 element, so when a row shows '.first()' or '.nth(N)' in its ` +
    `hint, you MUST include that exact suffix. Never write a bare getByRole/a[href] locator for ` +
    `a row flagged DUPLICATE.\n` +
    `- For links WITHOUT an href hint: use getByRole('link', { name: 'exact name' })\n` +
    `- COLLAPSED MENU RULE: If there is a hamburger/"Menu"/"Navigation" toggle button, the nav ` +
    `links are HIDDEN until it is clicked. Do NOT assert toBeVisible() on a nav link directly — it ` +
    `will fail. Instead either (a) click the menu button first, then assert the link, or (b) for an ` +
    `existence/navigation check use page.locator('a[href="…"]').first().click() and assert ` +
    `toHaveURL(...) — clicking a hidden-but-attached link still navigates. Reserve toBeVisible() for ` +
    `elements visible without opening a menu.\n` +
    `- EMOJI RULE: if a row shows  ← use /regex/  → write  getByRole(role, { name: /Name/i })\n` +
    `- NEVER invent IDs, class names, or attributes not shown in the data above\n` +
    `- For inputs: if the input has a non-empty aria_label, use getByLabel('…'). ` +
    `If aria_label is empty, use a locator based on the id, data-test, or name attribute shown in the crawl data. ` +
    `NEVER call getByLabel() when aria_label is empty — it will fail at runtime.\n` +
    `- PASSWORD INPUT RULE: <input type="password"> is NOT matched by getByRole('textbox'). ` +
    `Always use locator('input[type="password"]') or an id/data-test selector for password fields.\n` +
    `- CREDENTIAL RULE: If you write a login helper that fills a password field, use ` +
    `process.env.TESTPILOT_PASSWORD ?? 'fallbackPassword' where fallbackPassword is the actual ` +
    `password value from the credentials section in the product documentation above. ` +
    `Same for username: process.env.TESTPILOT_USER_NAME ?? 'fallbackUsername'. ` +
    `NEVER use ?? '' as a credential fallback — if the env var is missing the test must still run.\n` +
    `- SPA NAVIGATION RULE: For buttons that trigger SPA navigation (React/Vue/Angular apps), ` +
    `use getByRole('button', { name: '...' }) or locator('[data-test="..."]'). ` +
    `NEVER use locator('a[href="/some-page.html"]') for SPA navigation — those hrefs are '#' or absent.\n` +
    `- POST-LOGIN GOTO RULE: After calling login(page) or any login helper, ` +
    `navigate to the SPECIFIC page you need (e.g. page.goto(BASE_URL + 'inventory.html')), ` +
    `NEVER page.goto(BASE_URL) alone — the root URL triggers a client-side SPA redirect ` +
    `that completes AFTER Playwright's load event, causing the next locator to run on a blank page.\n` +
    `- STRICT MODE RULE: page.getByText() resolves every matching DOM node. ` +
    `If the text (e.g. a price like '$29.99', or 'total') might appear in more than one place, ` +
    `use a more specific container locator first (.summary_subtotal_label, [data-test="..."], etc.) ` +
    `then use toContainText() on that container. NEVER assert getByText('$X.XX').toBeVisible() for prices or totals.\n` +
    loginImport +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Each test must be independent\n` +
    coverageRules +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`
  );
}

/**
 * Parse the "# User Flows to Test" section from CONTEXT.md.
 * Returns an array of flows, each with a title, description and ordered steps.
 */
function parseUserFlowsFromContextMd(contextMd: string): { title: string; description: string; steps: string[] }[] {
  const flows: { title: string; description: string; steps: string[] }[] = [];
  const lines = contextMd.split('\n');

  // Find the "# User Flows to Test" section
  const FLOWS_HEADER  = /^#\s+User Flows? to Test/i;
  const FLOW_TITLE    = /^##\s+(.+)/;             // ## Flow Title
  const NUMBERED_STEP = /^\d+[.)]\s+(.+)/;
  const ANY_H1        = /^#\s+/;

  let inFlows = false;
  let cur: { title: string; description: string; steps: string[] } | null = null;

  const flush = () => {
    if (cur && (cur.steps.length > 0 || cur.description)) {
      flows.push({ ...cur });
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.match(FLOWS_HEADER)) { inFlows = true; continue; }
    if (inFlows && line.match(ANY_H1) && !line.match(FLOW_TITLE)) { flush(); inFlows = false; continue; }
    if (!inFlows) continue;

    const hm = line.match(FLOW_TITLE);
    if (hm) { flush(); cur = { title: hm[1].trim(), description: '', steps: [] }; continue; }

    if (cur) {
      const nm = line.match(NUMBERED_STEP);
      if (nm) { cur.steps.push(nm[1].trim()); continue; }
      // Non-step line before first step = description
      if (cur.steps.length === 0 && !line.startsWith('#') && line !== 'Steps:') {
        cur.description = cur.description ? `${cur.description} ${line}` : line;
      }
    }
  }
  flush();
  return flows;
}

/**
 * Build the user prompt for generating user-flows.spec.ts.
 * Tests are named "<Flow Title>: step N - <step text>" so the accuracy
 * tracker can find them deterministically.
 */
function buildUserFlowsPrompt(
  baseUrl: string,
  flows: { title: string; description: string; steps: string[] }[],
): string {
  const flowList = flows
    .map(f =>
      `### ${f.title}\n` +
      (f.description ? `${f.description}\n` : '') +
      f.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    )
    .join('\n\n');

  return (
    `Generate a Playwright test file that executes EVERY user flow step-by-step.\n` +
    `Base URL: ${baseUrl}\n\n` +
    `CRITICAL naming rule: Each test MUST be named "<Flow Title>: step <N> - <step description>"\n` +
    `Example: test("Typical User Journey: step 1 - Visit homepage", ...)\n` +
    `This naming convention is required for automated coverage tracking.\n\n` +
    `USER FLOWS:\n${flowList}\n\n` +
    `Rules:\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Write one test per step — each test is independent\n` +
    `- Only write browser-automatable steps (skip CLI/terminal steps)\n` +
    `- Use getByRole, getByLabel, getByText locators\n` +
    `- Navigate to the correct page at the start of each test\n` +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`
  );
}

/**
 * Build the user prompt for a SINGLE documented feature, grounded in real
 * crawled page data.  The LLM must derive all locators from the elements
 * and accessibility trees supplied here — no guessing.
 */
function buildDocFeaturePrompt(
  baseUrl: string,
  feature: { name: string; items: string[] },
  pages: PageData[],
  selectorHints?: { pageUrl: string; featureName: string; hints: { action: string; selector: string; confidence: string }[] }[],
): string {
  // Per-page budgets — interactives table + a11y tree are the primary locator sources.
  // Give a11y generous space; it compresses well (YAML not JSON).
  const PAGE_A11Y_BUDGET = 6_000;

  const crawlData = pages.slice(0, 5).map(p => {
    // Interactives table — the definitive locator reference for this page
    const interactivesTable = formatInteractives(p.elements, 60);

    // Accessibility tree (YAML snapshot)
    const a11y = p.accessibility_tree
      ? `\nAccessibility tree:\n${
          (typeof p.accessibility_tree === 'string'
            ? p.accessibility_tree
            : JSON.stringify(p.accessibility_tree, null, 2)
          ).slice(0, PAGE_A11Y_BUDGET)
        }\n`
      : '';

    return `=== ${p.url} (${p.title}) ===${interactivesTable}${a11y}`;
  }).join('\n\n');

  const itemList = feature.items.length
    ? feature.items.map(i => `- ${i}`).join('\n')
    : '(see feature name above)';

  // Build the verified selector map block if hints are available for this feature.
  // Normalise feature names for comparison: strip number prefixes and backtick escapes.
  const normalise = (s: string) =>
    s.toLowerCase()
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\d+[\d.]*[.)]\s*/, '')
      .trim();

  const featureHints = (selectorHints ?? [])
    .filter(m => normalise(m.featureName) === normalise(feature.name))
    .flatMap(m => m.hints);

  const verifiedMapBlock = featureHints.length > 0
    ? (
      `╔═ VERIFIED SELECTOR MAP (pre-resolved by LLM — USE THESE FIRST) ═╗\n` +
      featureHints.map(h =>
        `  action:     ${h.action}\n` +
        `  selector:   ${h.selector}\n` +
        `  confidence: ${h.confidence}`,
      ).join('\n\n') +
      `\n╚════════════════════════════════════════════════════════════════╝\n\n` +
      `⚠ SELECTOR RULE: For every action listed in the VERIFIED SELECTOR MAP above, ` +
      `you MUST use the exact selector shown. Do NOT substitute a different locator.\n\n`
    )
    : '';

  return (
    `Generate a Playwright test file that verifies the "${feature.name}" feature.\n` +
    `Base URL: ${baseUrl}\n\n` +
    verifiedMapBlock +
    `╔═ CRAWLED PAGE DATA — use ONLY the selectors, roles, text, and attributes found here ═╗\n` +
    `${crawlData}\n` +
    `╚══════════════════════════════════════════════════════════════════════════════════════╝\n\n` +
    `FEATURE: ${feature.name}\n` +
    `${itemList}\n\n` +
    `LOCATOR RULES (strictly enforced):\n` +
    `- LINK RULE: if a row shows  href="..."  ← prefer: locator(...)  → use that CSS locator\n` +
    `  Example:  link "Employees"  href="/Employee"  → page.locator('a[href="/Employee"]')\n` +
    `  Href-based locators are exact — they survive emoji and wording changes.\n` +
    `- For links WITHOUT an href hint: use getByRole('link', { name: 'exact name' })\n` +
    `- EMOJI RULE: if a row shows  ← use /regex/  → write  getByRole(role, { name: /Name/i })\n` +
    `- NEVER invent IDs, class names, or button text not present in the crawled data\n` +
    `- For text inputs: if aria_label is non-empty use getByLabel('…'); otherwise use an id/data-test/name locator from the crawl data. NEVER call getByLabel() when aria_label is empty.\n` +
    `- CREDENTIAL RULE: Any login helper must use process.env.TESTPILOT_PASSWORD ?? 'fallbackPassword' (actual password from credentials above) and process.env.TESTPILOT_USER_NAME ?? 'fallbackUsername'. NEVER use ?? '' for credentials.\n` +
    `- SPA NAVIGATION RULE: For buttons that trigger SPA navigation, use getByRole('button', { name: '...' }) or locator('[data-test="..."]'). NEVER use locator('a[href="/some-page.html"]') — SPA hrefs are '#' or absent.\n` +
    `- POST-LOGIN GOTO RULE: After login(page), navigate to the specific page needed (e.g. page.goto(BASE_URL + 'inventory.html')). NEVER page.goto(BASE_URL) alone after login — the SPA redirect fires after Playwright's load event, leaving the next locator on a blank page.\n` +
    `- STRICT MODE RULE: getByText() fails if it matches more than one element. For prices, totals, counts — use a specific container locator first, then toContainText(). NEVER use getByText('$X.XX') or getByText(/total/i) directly.\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Test names MUST be: "${feature.name}: <what is verified>"\n` +
    `- Each test is independent — call page.goto in each test\n` +
    `- Write at least one test per bullet item in the feature description\n` +
    `- If a bullet item has no matching element in the crawl data, add a skipped comment — do NOT fabricate a selector\n` +
    `⛔ ANTI-HALLUCINATION: ONLY test elements and text that appear in the crawl data above. ` +
    `DO NOT use knowledge about this site from your training data. ` +
    `If an element is not in the crawl data, skip the assertion with a // TODO comment.\n` +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`
  );
}

/**
 * @deprecated  Kept for reference — replaced by per-feature generation.
 * Build the system + user prompt for generating doc-features.spec.ts.
 */
function buildDocFeaturesPrompt(
  baseUrl: string,
  features: { name: string; items: string[] }[],
): string {
  const featureList = features
    .map(f => `### ${f.name}\n${f.items.map(i => `- ${i}`).join('\n')}`)
    .join('\n\n');

  return (
    `Generate a single Playwright test file that verifies EVERY documented feature listed below.\n` +
    `Base URL: ${baseUrl}\n\n` +
    `CRITICAL naming rule: Each test MUST be named "<Feature Name>: <what is verified>" — e.g. "Hero Section: Get Started button is visible".\n` +
    `This naming convention is required for automated coverage tracking.\n\n` +
    `DOCUMENTED FEATURES:\n${featureList}\n\n` +
    `Rules:\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Navigate to TARGET_URL (or the correct sub-path) before verifying each feature\n` +
    `- Use getByRole, getByLabel, getByText locators — NO CSS class selectors\n` +
    `- Each test is independent (call page.goto in each test)\n` +
    `- Write at least one test per bullet item in the documentation\n` +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`
  );
}

// ── generateMultiFile ─────────────────────────────────────────────────────────

export interface GenerateMultiFileOptions {
  workspace: Workspace;
  pages: PageData[];
  baseUrl: string;
  model: ChatModel;
  maxConcurrent?: number;
  /** Compact app-profile context block (Phase 2), injected into the system prompt. */
  appContext?: string;
  /** Called before each file — return true to abort generation early. */
  shouldStop?: () => boolean;
}

/** Read login info from the workspace .env file (written by the loop route after pre-login). */
function readLoginInfo(workspaceDir: string): LoginInfo | undefined {
  const envPath = path.join(workspaceDir, '.env');
  if (!existsSync(envPath)) return undefined;
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    const get = (key: string) => {
      const line = lines.find(l => l.startsWith(key + '='));
      return line ? line.slice(key.length + 1).trim() : '';
    };
    const loginUrl = get('TESTPILOT_LOGIN_URL');
    if (!loginUrl) return undefined;

    // Parse "KEY=value" lines into [key, value] pairs.
    const pairs = lines
      .map(l => {
        const eq = l.indexOf('=');
        return eq === -1 ? null : [l.slice(0, eq).trim(), l.slice(eq + 1).trim()] as const;
      })
      .filter((p): p is readonly [string, string] => p !== null);

    // Find the username credential var. The field key varies by site
    // (user_name → TESTPILOT_USER_NAME, username → TESTPILOT_USERNAME,
    //  email → TESTPILOT_EMAIL, …), so match broadly on USER/EMAIL while
    // excluding the helper vars (URL, SELECTOR, SUBMIT, PASSWORD).
    const usernamePair = pairs.find(([k]) =>
      /^TESTPILOT_/i.test(k) &&
      !/SELECTOR|SUBMIT|URL|PASSWORD/i.test(k) &&
      /USER|EMAIL|LOGIN_ID|ACCOUNT/i.test(k),
    );
    const usernameEnvVar = usernamePair?.[0] ?? 'TESTPILOT_USER_NAME';
    const usernameValue  = usernamePair?.[1] ?? '';

    const passwordPair = pairs.find(([k]) => /^TESTPILOT_.*PASSWORD/i.test(k));
    const passwordEnvVar = passwordPair?.[0] ?? 'TESTPILOT_PASSWORD';
    const passwordValue  = passwordPair?.[1] ?? '';

    return {
      loginUrl,
      usernameSelector: get('TESTPILOT_LOGIN_USERNAME_SELECTOR') || 'input[type="text"], input[type="email"]',
      submitButtonText: get('TESTPILOT_LOGIN_SUBMIT_TEXT') || 'Log in',
      usernameEnvVar,
      usernameValue,
      passwordEnvVar,
      passwordValue,
    };
  } catch {
    return undefined;
  }
}

export async function generateMultiFile(options: GenerateMultiFileOptions): Promise<string[]> {
  const { workspace, pages, baseUrl, model } = options;
  const testsDir = workspace.testsDir;
  mkdirSync(testsDir, { recursive: true });

  // Read login info captured during pre-login (if available)
  const loginInfo = readLoginInfo(workspace.dir);

  // Write shared fixtures file (with login() helper if we have login info)
  const fixturesPath = path.join(testsDir, 'fixtures.ts');
  writeFileSync(fixturesPath, buildFixturesFile(baseUrl, loginInfo), 'utf8');
  console.log(`  Wrote ${fixturesPath}${loginInfo ? ' (with login() helper)' : ''}`);

  // Read optional CONTEXT.md (product documentation + user flows + credentials)
  const contextMd = readContextMd(workspace.dir);
  const hasProductDoc = detectsProductDoc(contextMd);
  if (hasProductDoc) {
    console.log('  Product documentation detected — tests will be generated against the documented features.');
  } else if (contextMd) {
    console.log('  Context detected — credentials will be included in test prompts.');
  } else {
    console.log(
      '  ⚠ No product documentation provided — generating tests purely from the crawled live app. ' +
      'There is no source of truth, so tests assert what the app currently DOES (not what it SHOULD do). ' +
      'Upload a spec/doc for stronger, intent-based coverage.',
    );
  }

  // Warn when crawl is too shallow for reliable feature test generation
  if (pages.length <= 1 && hasProductDoc) {
    console.log(
      `  ⚠ Only ${pages.length} page(s) crawled — feature tests may have limited accuracy ` +
      `because the LLM has no data about internal pages (Employee list, PF details, etc.). ` +
      `Increase MAX_PAGES or enable authenticated deep crawl for better results.`,
    );
  }

  const systemPrompt = buildSystemPrompt(contextMd, options.appContext);
  const writtenFiles: string[] = [fixturesPath];

  // Discovered features (from the synthesis step) → injected as a coverage
  // checklist so per-page generation is aware of the broader capabilities/flows.
  let featureChecklist = '';
  try {
    const feats = workspace.readFeatures();
    if (Array.isArray(feats) && feats.length > 0) {
      featureChecklist = renderFeatureChecklist(feats as DiscoveredFeature[]);
      console.log(`  Loaded ${feats.length} discovered feature(s) for coverage guidance`);
    }
  } catch { /* non-fatal — generate without the checklist */ }

  for (const page of pages) {
    if (options.shouldStop?.()) { console.log('  Generation stopped by user.'); break; }
    const fileName = urlToFileName(page.url, baseUrl);
    const filePath = path.join(testsDir, `${fileName}.spec.ts`);
    console.log(`  Generating tests for ${page.url} → ${fileName}.spec.ts`);

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: buildPageTestPrompt(page, baseUrl, hasProductDoc, featureChecklist) },
      ];
      const result  = await model.invoke(messages, { temperature: 0.2 });
      const cleaned = extractTypeScript(result);

      const looksLikeTest = cleaned.includes('test(') || cleaned.includes('test.describe(');
      const hasAssertion  = cleaned.includes('expect(');
      if (looksLikeTest && hasAssertion) {
        writeFileSync(filePath, sanitizeImports(cleaned), 'utf8');
        writtenFiles.push(filePath);
        console.log(`  Wrote ${filePath}`);
      } else if (looksLikeTest && !hasAssertion) {
        // A test with no expect() verifies nothing — skip it rather than pad the
        // suite with green-but-meaningless specs.
        console.log(`  Skipped ${fileName} — generated test had no expect() assertions (nothing to verify).`);
      } else {
        const preview = result.slice(0, 200).replace(/\n/g, ' ');
        console.log(`  Skipped ${fileName} — output didn't look like a test file. Model returned: "${preview}"`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Re-throw auth errors immediately — no point trying remaining files with a bad key
      if (msg.includes('401') || msg.includes('authentication_error') || msg.includes('invalid x-api-key')) {
        throw e;
      }
      console.log(`  Failed to generate ${fileName}: ${msg}`);
    }
  }

  // ── Generate one spec file per documented feature/use-case ──────────────
  // Each "##" section from the product documentation becomes its own
  // <feature-slug>.spec.ts.  Crucially, the prompt for every feature includes
  // the ACTUAL crawled page elements so the LLM can only use real selectors.
  if (hasProductDoc && contextMd) {
    const docFeatures = parseFeaturesFromDoc(contextMd);
    if (docFeatures.length > 0) {
      console.log(`  Generating ${docFeatures.length} per-feature spec file(s) from crawled data…`);

      // Load Phase 1.75 selector hints if available.
      // These are pre-resolved by an LLM that examined the real DOM of each page
      // and mapped every documented action to a precise Playwright selector.
      type SelectorHint = { action: string; selector: string; confidence: string };
      type PageSelectorMap = { pageUrl: string; featureName: string; hints: SelectorHint[] };
      let selectorHints: PageSelectorMap[] = [];
      try {
        const hintsRaw = workspace.readSelectorHints();
        if (Array.isArray(hintsRaw)) selectorHints = hintsRaw as PageSelectorMap[];
        if (selectorHints.length > 0) {
          console.log(`  Loaded ${selectorHints.length} pre-resolved selector map(s) from Phase 1.75`);
        }
      } catch { /* non-fatal — generate without hints */ }

      // System prompt shared by all feature generations
      const featureSystemPrompt =
        'You are an expert Playwright test engineer (TypeScript). ' +
        'Each user message includes an INTERACTIVE ELEMENTS table listing every clickable and fillable ' +
        'element on the page with its ARIA role, accessible name, and href (for links). ' +
        'LINK RULE: if a row shows  href="..."  ← prefer: locator(...)  use that CSS locator: ' +
        'page.locator(\'a[href="/path"]\') — this is the most precise locator. ' +
        'Example:  link "Employees"  href="/Employee"  →  page.locator(\'a[href="/Employee"]\') ' +
        'EMOJI RULE: if a row ends with  ← use /regex/  write  getByRole(role, { name: /Name/i })  ' +
        '(the element has an emoji prefix). ' +
        'ANTI-HALLUCINATION: NEVER test content not visible in the crawl data — ' +
        'ignore any training-data knowledge about this site. ' +
        'Do NOT invent selectors not in the crawl data. ' +
        'If a required element is missing from the crawl, skip that assertion with a comment. ' +
        'CREDENTIAL RULE: Any login helper must use process.env.TESTPILOT_PASSWORD ?? \'actual_password\' and ' +
        'process.env.TESTPILOT_USER_NAME ?? \'actual_username\' where the actual values come from the ' +
        'credentials section in the product documentation. NEVER use ?? \'\' — empty fallback breaks offline runs. ' +
        'INPUT SELECTOR RULE: Only use getByLabel() when the input has a non-empty aria_label. ' +
        'For inputs with empty aria_label, use id/data-test/name attributes from the crawl data. ' +
        'PASSWORD INPUT: <input type="password"> is NOT matched by getByRole(\'textbox\') in Playwright — ' +
        'always use locator(\'input[type="password"]\') or an id/data-test selector for password inputs. ' +
        'SPA NAVIGATION RULE: For buttons triggering SPA navigation, use getByRole(\'button\', { name: \'...\' }) ' +
        'or locator(\'[data-test="..."]\') — NEVER locator(\'a[href="/page.html"]\') for SPA buttons (hrefs are \'#\' or absent). ' +
        'POST-LOGIN GOTO RULE: After login(page), navigate to the SPECIFIC page needed ' +
        '(e.g. page.goto(BASE_URL + \'inventory.html\')). NEVER page.goto(BASE_URL) alone after login — ' +
        'the SPA root URL triggers a client-side redirect that fires AFTER Playwright\'s load event, ' +
        'so the next locator runs on a blank page and times out. ' +
        'STRICT MODE RULE: getByText() fails in strict mode if it matches more than one element. ' +
        'For prices, amounts, totals — use a specific container locator (class or data-test), then toContainText(). ' +
        'NEVER assert getByText(\'$X.XX\') or getByText(/total/i) directly on a summary page. ' +
        'Test names MUST follow: "<Feature Name>: <what is verified>". ' +
        'Do NOT use test.describe blocks — flat test() calls only. ' +
        'Return ONLY the TypeScript file — no markdown fences, no explanation.\n\n' +
        (selectorHints.length > 0
          ? 'IMPORTANT: Each user message may contain a VERIFIED SELECTOR MAP section. ' +
            'When present, you MUST use the exact selectors listed there — they were ' +
            'pre-resolved from the live DOM and are guaranteed to work.\n\n'
          : '') +
        contextMd;

      const generatedSlugs = new Set<string>();

      for (const feature of docFeatures) {
        if (options.shouldStop?.()) { console.log('  Generation stopped by user (doc features).'); break; }
        // Ensure unique file names when two headings produce the same slug
        let slug = featureNameToSlug(feature.name);
        if (generatedSlugs.has(slug)) slug = `${slug}-${generatedSlugs.size}`;
        generatedSlugs.add(slug);

        const featureSpecPath = path.join(testsDir, `${slug}.spec.ts`);
        console.log(`  Generating ${slug}.spec.ts for "${feature.name}" (${feature.items.length} item(s))…`);

        try {
          const featureUserPrompt = buildDocFeaturePrompt(baseUrl, feature, pages, selectorHints);
          const featureResult = await model.invoke([
            { role: 'system', content: featureSystemPrompt },
            { role: 'user',   content: featureUserPrompt },
          ], { temperature: 0.2 });
          const featureCleaned = extractTypeScript(featureResult);
          if ((featureCleaned.includes('test(') || featureCleaned.includes('test.describe(')) && featureCleaned.includes('expect(')) {
            writeFileSync(featureSpecPath, sanitizeImports(featureCleaned), 'utf8');
            writtenFiles.unshift(featureSpecPath);
            console.log(`  Wrote ${slug}.spec.ts`);
          } else {
            console.log(`  ${slug} — no test code returned, skipping.`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('401') || msg.includes('authentication_error') || msg.includes('invalid x-api-key')) {
            throw e;
          }
          console.log(`  Failed to generate ${slug}.spec.ts: ${msg}`);
        }
      }
    }
  }

  // ── Generate user-flows.spec.ts (when user flows are present) ────────────
  // Generates one test per flow step with naming "Flow Title: step N - ..."
  // so the accuracy tracker can match them back to flows deterministically.
  if (contextMd) {
    const userFlows = parseUserFlowsFromContextMd(contextMd);
    // Only generate browser-relevant flows (skip flows that are entirely CLI-based)
    const browserFlows = userFlows.filter(f =>
      f.steps.some(s =>
        !/\bnpm\b|\bnpx\b|\brun\b terminal|\bbash\b|\bcli\b|\bcommand\b|\bterminal\b/i.test(s) ||
        /\bvisit\b|\bnavigate\b|\bclick\b|\bopen\b|\bbrowse\b|\bgo to\b|\bpurchase\b|\badd to cart\b|\bsign in\b|\blog in\b|\bregister\b|\bcheckout\b/i.test(s)
      )
    );
    if (browserFlows.length > 0) {
      const flowSpecPath = path.join(testsDir, 'user-flows.spec.ts');
      console.log(`  Generating user-flows.spec.ts for ${browserFlows.length} user flow(s)…`);
      try {
        const flowSystemPrompt =
          'You are an expert Playwright test engineer (TypeScript). ' +
          'Generate a user-flow test file where EACH test covers one step of a user flow. ' +
          'CRITICAL: Test names MUST follow the format "<Flow Title>: step <N> - <step description>" — ' +
          'e.g. test("Typical User Journey: step 2 - Click Get Started", ...). ' +
          'Do NOT use test.describe blocks — flat test() calls only. ' +
          'Use getByRole, getByLabel, getByText locators. Skip steps that require a terminal/CLI. ' +
          'Return ONLY TypeScript code — no markdown fences, no explanation.\n\n' +
          contextMd;

        const flowUserPrompt = buildUserFlowsPrompt(baseUrl, browserFlows);
        const flowResult  = await model.invoke([
          { role: 'system', content: flowSystemPrompt },
          { role: 'user',   content: flowUserPrompt },
        ], { temperature: 0.2 });
        const flowCleaned = extractTypeScript(flowResult);
        if ((flowCleaned.includes('test(') || flowCleaned.includes('test.describe(')) && flowCleaned.includes('expect(')) {
          writeFileSync(flowSpecPath, sanitizeImports(flowCleaned), 'utf8');
          // Put user-flows near the front so it runs before per-feature specs
          writtenFiles.unshift(flowSpecPath);
          console.log(`  Wrote user-flows.spec.ts (${browserFlows.length} flow(s), ${browserFlows.reduce((n, f) => n + f.steps.length, 0)} steps)`);
        } else {
          console.log(`  user-flows generation returned no test code — skipping.`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('401') || msg.includes('authentication_error') || msg.includes('invalid x-api-key')) {
          throw e;
        }
        console.log(`  Failed to generate user-flows.spec.ts: ${msg}`);
      }
    }
  }

  return writtenFiles;
}

// ── runGenerateSuite ──────────────────────────────────────────────────────────

export interface RunGenerateSuiteOptions {
  url?: string;
  skipExplore: boolean;
  depth: number;
  maxPages: number;
  /** Claude model name string — only used when chatModel is not provided. */
  model: string;
  chatModel?: ChatModel;
  workspace: Workspace;
  /** Compact app-profile context block (Phase 2), forwarded to generation. */
  appContext?: string;
  /** Called before each file generation — return true to abort the loop early. */
  shouldStop?: () => boolean;
}

export async function runGenerateSuite(options: RunGenerateSuiteOptions): Promise<void> {
  const { workspace } = options;
  const siteMapPath = workspace.siteMapFile;

  let startUrl = options.url;

  if (!options.skipExplore) {
    if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
      throw new Error('URL required unless skipExplore is true.');
    }
    console.log('Generate suite — running explorer...');
    // Import lazily to avoid circular deps; runSiteExplorer is in the same lib
    const { runSiteExplorer } = await import('./site-explorer');
    await runSiteExplorer({
      url: startUrl,
      depth: options.depth,
      maxPages: options.maxPages,
      outputDir: workspace.dir,
    });
  } else {
    startUrl = startUrl || loadStartUrlFromSiteMap(siteMapPath);
    console.log(`Generate suite — skip explore, TARGET_URL will be ${startUrl}`);
  }

  if (!existsSync(siteMapPath)) {
    throw new Error(`Missing ${siteMapPath} — run exploration first.`);
  }

  const siteMap = JSON.parse(readFileSync(siteMapPath, 'utf8')) as {
    start_url?: string;
    pages?: { url: string; title: string; elements: Record<string, unknown>; accessibility_tree?: unknown }[];
  };

  if (!siteMap.pages?.length) {
    throw new Error('site_map.json has no pages.');
  }

  const effectiveStart = siteMap.start_url || startUrl!;

  // chatModel is required — callers must build it via createModelFromConfig() so
  // that org-level API keys (OrgApiKey table) are respected.
  if (!options.chatModel) throw new Error('runGenerateSuite: options.chatModel is required');
  const model = options.chatModel;

  console.log('  Generating multi-file test suite...');
  await generateMultiFile({
    workspace,
    pages: siteMap.pages.map(p => ({
      url:               p.url,
      title:             p.title,
      elements:          p.elements,
      accessibility_tree: p.accessibility_tree,
    })),
    baseUrl: effectiveStart,
    model,
    appContext: options.appContext,
    shouldStop: options.shouldStop,
  });
  console.log('  Test suite generation complete.');
}

function loadStartUrlFromSiteMap(siteMapPath: string): string {
  if (!existsSync(siteMapPath)) {
    throw new Error(`Missing ${siteMapPath}. Run with a URL first or run explorer manually.`);
  }
  const raw = JSON.parse(readFileSync(siteMapPath, 'utf8')) as { start_url?: string };
  if (!raw.start_url) throw new Error('site_map.json has no start_url.');
  return raw.start_url;
}
