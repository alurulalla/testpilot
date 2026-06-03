/**
 * Multi-page form field detector.
 *
 * Scans the given URL AND follows form-related links (register, sign up,
 * contact, profile, account creation, etc.) to discover ALL forms across
 * the site — not just the landing page.
 *
 * Returns results grouped by page so the UI can display them clearly.
 */
import { chromium, Page, BrowserContext } from 'playwright';
import { ContextField } from './url-context-store';

// ── Browser launcher ──────────────────────────────────────────────────────────
//
// Vercel's serverless runtime lacks the system shared-libs (libX11, libXcomposite,
// etc.) that Playwright's bundled Chromium requires.  @sparticuz/chromium ships a
// statically-linked Chromium that works inside Lambda / Vercel — it extracts itself
// to /tmp on first use and returns the path.
//
// Locally we skip that entirely and use Playwright's own bundled browser.

async function launchBrowser() {
  if (process.env.VERCEL === '1') {
    // Dynamic import keeps @sparticuz/chromium out of the local code path and
    // avoids issues with its ES-module-only package format in Jest / ts-node.
    const { default: Chromium } = await import('@sparticuz/chromium');
    const executablePath = await Chromium.executablePath();
    return chromium.launch({
      headless: true,
      executablePath,                                    // serverless binary in /tmp
      args: [
        ...Chromium.args,                                // serverless-required flags
        '--disable-blink-features=AutomationControlled', // stealth
      ],
    });
  }
  // Local development — use Playwright's bundled Chromium as normal.
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DetectedField {
  key: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  sensitive: boolean;
}

export interface DetectedFormGroup {
  /** Canonical page URL */
  pageUrl: string;
  /** <title> of the page */
  pageTitle: string;
  /** Inferred form purpose, e.g. "Login", "Register" */
  formLabel: string;
  fields: DetectedField[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SKIP_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'file', 'color', 'range', 'checkbox', 'radio',
  'search',   // navigation / site-search inputs — not credential fields
]);

const SENSITIVE_PATTERNS = /password|secret|token|key|pin|cvv|ssn/i;

/** URL path segments that strongly suggest a form page */
const FORM_PATH_PATTERNS = [
  /register/i, /signup/i, /sign.up/i, /create.account/i, /join/i,
  /login/i, /signin/i, /sign.in/i, /log.in/i,
  /contact/i, /enquir/i, /feedback/i, /support/i,
  /profile/i, /account/i, /user/i, /forgot/i, /reset/i,
  /checkout/i, /order/i, /booking/i, /apply/i, /subscribe/i,
];

/**
 * Common auth paths to probe directly when anchor-based link discovery yields
 * nothing (e.g. the home page is behind bot-protection, or uses JS-only nav).
 * These are tried in order; already-visited URLs are skipped automatically.
 */
const FALLBACK_AUTH_PATHS = [
  '/login', '/signin', '/sign-in', '/sign_in',
  '/signup', '/register', '/sign-up', '/sign_up', '/create-account',
  '/account/login', '/user/login', '/auth/login', '/users/sign_in',
];

/** Anchor text patterns that suggest a link leads to a form */
const FORM_LINK_TEXT_PATTERNS = [
  /register/i, /sign.?up/i, /create.account/i, /join/i,
  /log.?in/i, /sign.?in/i,
  /contact/i, /feedback/i, /support/i,
  /forgot.?password/i, /reset.?password/i,
  /apply/i, /subscribe/i, /book/i, /checkout/i,
];

// ── Page-level field extraction ───────────────────────────────────────────────

async function extractFieldsFromPage(page: Page): Promise<DetectedField[]> {
  const skipTypes = Array.from(SKIP_TYPES);
  const fields: DetectedField[] = await page.evaluate((skipTypes) => {
    const seen = new Set<string>();
    const results: DetectedField[] = [];

    const els = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      ),
    );

    for (const el of els) {
      const rawType = el instanceof HTMLInputElement
        ? (el.type || 'text').toLowerCase()
        : el.tagName.toLowerCase();

      if (skipTypes.includes(rawType)) continue;

      const rawName = (el as HTMLInputElement).name || el.id || (el as HTMLInputElement).placeholder || '';
      if (!rawName) continue;
      const key = rawName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);

      // Label resolution (priority order):
      // 1. <label for="id"> or <label for="name">
      // 2. Ancestor <label> element
      // 3. aria-label / aria-labelledby
      // 4. Nearby table-cell text (for traditional JSP/table-layout apps)
      // 5. Placeholder
      // 6. Prettified name/id attribute (last resort)
      let label = '';

      // 1a. label[for="id"]
      if (!label && el.id) {
        const lEl = document.querySelector(`label[for="${el.id}"]`);
        if (lEl) label = lEl.textContent?.trim() ?? '';
      }
      // 1b. label[for="name"] — some legacy apps use name instead of id in for=
      if (!label && (el as HTMLInputElement).name) {
        const lEl = document.querySelector(`label[for="${(el as HTMLInputElement).name}"]`);
        if (lEl) label = lEl.textContent?.trim() ?? '';
      }
      // 2. Ancestor <label>
      if (!label) {
        const closestLabel = el.closest('label');
        if (closestLabel) {
          const clone = closestLabel.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
          label = clone.textContent?.trim() ?? '';
        }
      }
      // 3. aria-label / aria-labelledby
      if (!label) label = el.getAttribute('aria-label') ?? '';
      if (!label) {
        const lbId = el.getAttribute('aria-labelledby');
        if (lbId) label = document.getElementById(lbId)?.textContent?.trim() ?? '';
      }
      // 4. Nearby text in table-layout forms (th/td sibling, or preceding bold/strong)
      if (!label) {
        // Previous table cell in the same row
        const cell = el.closest('td, th');
        if (cell) {
          const prevCell = cell.previousElementSibling;
          if (prevCell) label = prevCell.textContent?.trim() ?? '';
        }
      }
      if (!label) {
        // Preceding sibling that looks like a label (b, strong, span, p, div)
        let sib = el.previousElementSibling;
        while (sib && !label) {
          const tag = sib.tagName.toLowerCase();
          if (['input','select','textarea','button'].includes(tag)) break; // stop at another field
          const t = sib.textContent?.trim() ?? '';
          if (t.length > 0 && t.length < 60) label = t;
          sib = sib.previousElementSibling;
        }
      }
      if (!label) {
        // Parent's immediately preceding sibling (common in div-based forms)
        const parentSib = el.parentElement?.previousElementSibling;
        if (parentSib) {
          const t = parentSib.textContent?.trim() ?? '';
          if (t.length > 0 && t.length < 60) label = t;
        }
      }
      // 5. Placeholder
      if (!label) label = (el instanceof HTMLInputElement ? el.placeholder : '') || '';
      // 6. Prettify the raw name/id as absolute last resort
      if (!label) {
        label = rawName
          .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → words
          .replace(/[._-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^\w/, (c: string) => c.toUpperCase());
      }

      const sensitive = /password|secret|token|key|pin|cvv|ssn/i.test(
        rawType + ' ' + rawName + ' ' + label,
      );

      results.push({
        key,
        label: label.replace(/[*:]+$/, '').trim(), // strip trailing asterisk/colon from required markers
        type: rawType,
        placeholder: (el instanceof HTMLInputElement ? el.placeholder : '') ?? '',
        required: (el as HTMLInputElement).required ?? false,
        sensitive,
      });
    }

    return results;
  }, skipTypes);

  return fields.filter(f => f.key.length > 0);
}

// ── Auth-field heuristics ─────────────────────────────────────────────────────

/** Returns true when the field looks like a username / email login field. */
function isUserField(f: DetectedField): boolean {
  return (
    f.type === 'email' ||
    /^(user(name)?|email|login|account|id)$/i.test(f.key) ||
    /user(name)?|e.?mail|login|account/i.test(f.key + ' ' + f.label)
  );
}

/** Returns true when the field looks like a password field. */
function isPasswordField(f: DetectedField): boolean {
  return (
    f.type === 'password' ||
    /password|passwd|pwd/i.test(`${f.type} ${f.key} ${f.label}`)
  );
}

/**
 * Returns true when a field is clearly a site-search / navigation input
 * (e.g. Apple's global "Search apple.com" bar) and NOT a real credential field.
 *
 * Explicit exclusions: password, email and other sensitive fields are NEVER
 * stripped even if their label happens to contain the word "search".
 */
function isSearchLikeField(f: DetectedField): boolean {
  if (f.sensitive || f.type === 'email' || f.type === 'password') return false;
  return /\bsearch\b/i.test(`${f.key} ${f.label} ${f.placeholder}`);
}

/**
 * A form is "search-only" — and should be discarded — when EVERY field is a
 * search-like input with no authentication intent.
 */
function isSearchOnlyForm(fields: DetectedField[]): boolean {
  if (fields.length === 0) return false;
  return fields.every(f => isSearchLikeField(f) && !isPasswordField(f) && !isUserField(f));
}

/**
 * Returns true when the detected fields look like a guest order-lookup form
 * rather than a real account-login form.
 *
 * Heuristic: form has an "order number" style field + an email (no password).
 * This avoids mislabelling Apple's /shop/sign_in guest-lookup section as Login.
 */
function isOrderLookupForm(fields: DetectedField[]): boolean {
  const hasOrderField = fields.some(f =>
    /order.?(number|num|no|id)|order_id|orderno/i.test(`${f.key} ${f.label} ${f.placeholder}`),
  );
  const hasPassword = fields.some(isPasswordField);
  return hasOrderField && !hasPassword;
}

/**
 * Infer a human-readable label for the form.
 *
 * Important: for "Login", the URL/title keyword match is treated as a
 * *hint*, not a verdict.  We still require at least one password OR
 * username/email field to confirm it is genuinely an auth form — this
 * prevents labelling a page as "Login" when it loaded a sign-in URL but
 * only contains a search bar (e.g. apple.com redirecting to a search page).
 */
function inferFormLabel(pageTitle: string, pageUrl: string, fields?: DetectedField[]): string {
  const combined = (pageTitle + ' ' + pageUrl).toLowerCase();

  const hasPassword = fields?.some(isPasswordField) ?? false;
  const hasUserField = fields?.some(isUserField) ?? false;
  const looksLikeLogin = hasPassword || hasUserField;

  // Register / sign-up — also needs at least one real input beyond a search bar
  if (/register|signup|sign.up|create.account|join/i.test(combined)) return 'Register';

  // Login — require actual auth-like fields (not just a search bar on /sign-in)
  if (/login|signin|sign.in|log.in/i.test(combined)) {
    if (looksLikeLogin) return 'Login';
    // URL looks like a login page but no auth fields found (e.g. redirected
    // to a search page, or form is in an iframe on a different origin) → skip
    return '__DISCARD__';
  }

  if (/contact|feedback|enquir/i.test(combined)) return 'Contact';
  if (/forgot|reset.password/i.test(combined)) return 'Password Reset';
  if (/profile/i.test(combined)) return 'Profile';
  if (/checkout|order/i.test(combined)) return 'Checkout';
  if (/subscribe/i.test(combined)) return 'Subscribe';
  if (/apply/i.test(combined)) return 'Application';

  // Field-content heuristic: password + username/email → Login (regardless of URL)
  if (hasPassword && hasUserField) return 'Login';
  if (hasPassword) return 'Login';

  return pageTitle || 'Form';
}

// ── Link discovery ────────────────────────────────────────────────────────────

async function discoverFormLinks(page: Page, origin: string): Promise<string[]> {
  const links = await page.evaluate(
    ({ origin, formPathPatterns, formLinkTextPatterns }) => {
      const results = new Set<string>();
      const anchors = Array.from(document.querySelectorAll('a[href]'));

      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href;
        if (!href || !href.startsWith(origin)) continue;
        // Strip hash, query params, AND ;jsessionid=… path extensions so the
        // same logical page with different session IDs isn't added twice
        const normalized = href.split('#')[0].split('?')[0].replace(/;[^/?#]*/g, '');
        if (normalized === origin || normalized === origin + '/') continue;

        const text = a.textContent?.trim() ?? '';
        const path = new URL(normalized).pathname.toLowerCase();

        const pathMatch = formPathPatterns.some(p => new RegExp(p).test(path));
        const textMatch = formLinkTextPatterns.some(p => new RegExp(p).test(text));

        if (pathMatch || textMatch) results.add(normalized);
      }
      return Array.from(results);
    },
    {
      origin,
      formPathPatterns: FORM_PATH_PATTERNS.map(r => r.source),
      formLinkTextPatterns: FORM_LINK_TEXT_PATTERNS.map(r => r.source),
    },
  );

  return links.slice(0, 10); // cap at 10 form pages to avoid runaway scanning
}

// ── Main scan ─────────────────────────────────────────────────────────────────

/** Strip ;jsessionid=… and query params for stable page deduplication */
function dedupeKey(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return u.origin + u.pathname.replace(/;[^/?#]*/g, '');
  } catch {
    return pageUrl.split('?')[0].split('#')[0].replace(/;[^/?#]*/g, '');
  }
}

export async function detectAllFormFields(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<DetectedFormGroup[]> {
  const log = (msg: string) => onProgress?.(msg);
  const groups: DetectedFormGroup[] = [];
  const visitedUrls = new Set<string>();

  let origin: string;
  try { origin = new URL(url).origin; } catch { origin = url; }

  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      // Real-looking Chrome 131 / macOS user-agent
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Google Chrome";v="131","Chromium";v="131","Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
      },
    });
    // Remove navigator.webdriver — the most common automation-detection signal.
    // Also expose window.chrome so Chrome-fingerprinting checks pass.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    async function scanPage(pageUrl: string): Promise<void> {
      // Use jsessionid-stripped key so the same logical page isn't scanned twice
      const key = dedupeKey(pageUrl);
      if (visitedUrls.has(key)) return;
      visitedUrls.add(key);

      log(`Scanning ${pageUrl}…`);
      const page = await ctx.newPage();
      try {
        // domcontentloaded is far more reliable than networkidle for sites
        // with background polling or persistent connections (e.g. Java apps)
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        // Wait until at least one input appears, or 1.5 s — whichever comes first.
        // Using waitForSelector means we capture fields as soon as they exist in the DOM,
        // without giving SPA routers time to redirect to a post-auth page (e.g. saucedemo
        // would redirect to /inventory.html if we waited a flat 400 ms after hydration).
        await page.waitForSelector('input, textarea, select', { timeout: 1500 }).catch(() => {});
        const pageTitle = await page.title();
        // Strip site-search / navigation inputs (e.g. Apple's global "Search apple.com"
        // bar) before grouping, so they don't pollute credential-form field lists.
        const rawFields = await extractFieldsFromPage(page);
        const fields = rawFields.filter(f => !isSearchLikeField(f));

        if (fields.length > 0) {
          const formLabel = inferFormLabel(pageTitle, page.url(), fields);

          // Drop: search-only forms (nav search bars), guest order-lookup forms
          // (order-number + email, no password), OR pages that look like a login
          // URL but had no real auth fields (redirected, iframe'd, etc.)
          if (formLabel === '__DISCARD__' || isSearchOnlyForm(fields) || isOrderLookupForm(fields)) {
            log(`  Skipping — no real credential fields (search-only, order-lookup, or auth redirect)`);
          } else {
            groups.push({ pageUrl: page.url(), pageTitle, formLabel, fields });
            log(`  Found ${fields.length} field(s) — "${formLabel}"`);
          }
        }

        // Only follow links from the entry page to avoid infinite crawling
        if (key === dedupeKey(url)) {
          const formLinks = await discoverFormLinks(page, origin);
          log(`  Found ${formLinks.length} form-related link(s) to follow`);

          // Fallback: if anchor discovery found nothing (e.g. home page served a
          // bot-protection challenge, or navigation is JS-only with no <a> tags),
          // probe the most common auth paths directly. Already-visited URLs are
          // skipped by the visitedUrls guard inside scanPage.
          const toScan =
            formLinks.length > 0
              ? formLinks
              : (() => {
                  log('  No anchor-based form links found — probing common auth paths…');
                  return FALLBACK_AUTH_PATHS
                    .map(p => `${origin}${p}`)
                    .filter(u => !visitedUrls.has(dedupeKey(u)));
                })();

          for (const link of toScan) {
            await scanPage(link);
          }
        }
      } catch (err) {
        log(`  ⚠ Could not scan ${pageUrl}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await page.close();
      }
    }

    await scanPage(url);
    await ctx.close();
  } finally {
    await browser.close();
  }

  return deduplicateGroups(groups);
}

/**
 * Deduplicate detected form groups.
 *
 * Traditional web apps (e.g. ParaBank, Java EE) include a login sidebar on
 * every page, so "secondary" pages (Forgot Password, Register, Contact…) end
 * up contributing duplicate Login fields mixed with their own form fields.
 *
 * Strategy:
 *  • For groups sharing the same formLabel, keep the one with the fewest
 *    fields — that's the "pure" form (e.g. the login page itself has only
 *    username + password, while other pages add personal-info fields from the
 *    sidebar contamination).
 *  • If field counts are equal, prefer the group whose page URL most closely
 *    matches the label (e.g. /login.htm beats /contact.htm for "Login").
 */
function deduplicateGroups(groups: DetectedFormGroup[]): DetectedFormGroup[] {
  const best = new Map<string, DetectedFormGroup>();

  for (const g of groups) {
    const existing = best.get(g.formLabel);
    if (!existing) {
      best.set(g.formLabel, g);
      continue;
    }
    // Prefer fewer fields (purer form)
    if (g.fields.length < existing.fields.length) {
      best.set(g.formLabel, g);
    } else if (g.fields.length === existing.fields.length) {
      // Tie-break: prefer the URL that matches the label keyword
      const labelKw = g.formLabel.toLowerCase().replace(/\s+/g, '');
      if (g.pageUrl.toLowerCase().includes(labelKw) && !existing.pageUrl.toLowerCase().includes(labelKw)) {
        best.set(g.formLabel, g);
      }
    }
  }

  // Return in original discovery order (stable)
  const seen = new Set<string>();
  return groups.filter(g => {
    if (seen.has(g.formLabel)) return false;
    if (best.get(g.formLabel) !== g) return false;
    seen.add(g.formLabel);
    return true;
  });
}

// ── Conversion helpers ────────────────────────────────────────────────────────

export function detectedToContextField(d: DetectedField, pageUrl?: string): ContextField {
  return {
    key: pageUrl ? `${inferPageKey(pageUrl)}_${d.key}` : d.key,
    label: d.label || d.key,
    type: d.type,
    value: '',
    sensitive: d.sensitive || SENSITIVE_PATTERNS.test(d.key + ' ' + d.label),
  };
}

function inferPageKey(pageUrl: string): string {
  try {
    const path = new URL(pageUrl).pathname;
    const last = path.split('/').filter(Boolean).pop() ?? 'page';
    return last.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  } catch {
    return 'page';
  }
}

/** Flatten all groups into a deduplicated list of ContextFields.
 *  Fields from different pages get a page-prefix on their key. */
export function groupsToContextFields(groups: DetectedFormGroup[]): ContextField[] {
  if (groups.length === 0) return [];

  // If only one page, no prefix needed
  if (groups.length === 1) {
    return groups[0].fields.map(f => detectedToContextField(f));
  }

  // Multiple pages: prefix by form label to avoid key collisions
  // e.g. login_username vs register_username
  const seen = new Set<string>();
  const result: ContextField[] = [];

  for (const group of groups) {
    const prefix = group.formLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
    for (const f of group.fields) {
      const key = `${prefix}_${f.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        label: `${group.formLabel} — ${f.label}`,
        type: f.type,
        value: '',
        sensitive: f.sensitive || SENSITIVE_PATTERNS.test(f.key + ' ' + f.label),
      });
    }
  }

  return result;
}
