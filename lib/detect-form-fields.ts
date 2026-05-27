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

      // Label resolution: for → closest label → aria-label → aria-labelledby → placeholder → name
      let label = '';
      if (el.id) {
        const lEl = document.querySelector(`label[for="${el.id}"]`);
        if (lEl) label = lEl.textContent?.trim() ?? '';
      }
      if (!label) {
        const closestLabel = el.closest('label');
        if (closestLabel) {
          // Clone to remove nested input text
          const clone = closestLabel.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
          label = clone.textContent?.trim() ?? '';
        }
      }
      if (!label) label = el.getAttribute('aria-label') ?? '';
      if (!label) {
        const lbId = el.getAttribute('aria-labelledby');
        if (lbId) label = document.getElementById(lbId)?.textContent?.trim() ?? '';
      }
      if (!label) label = (el instanceof HTMLInputElement ? el.placeholder : '') || rawName;

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

/** Infer a human-readable label for the form based on page title and URL */
function inferFormLabel(pageTitle: string, pageUrl: string): string {
  const combined = (pageTitle + ' ' + pageUrl).toLowerCase();
  if (/register|signup|sign.up|create.account|join/i.test(combined)) return 'Register';
  if (/login|signin|sign.in|log.in/i.test(combined)) return 'Login';
  if (/contact|feedback|enquir/i.test(combined)) return 'Contact';
  if (/forgot|reset.password/i.test(combined)) return 'Password Reset';
  if (/profile|account/i.test(combined)) return 'Profile';
  if (/checkout|order/i.test(combined)) return 'Checkout';
  if (/subscribe/i.test(combined)) return 'Subscribe';
  if (/apply/i.test(combined)) return 'Application';
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

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

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
        const fields = await extractFieldsFromPage(page);

        if (fields.length > 0) {
          groups.push({
            pageUrl: page.url(),
            pageTitle,
            formLabel: inferFormLabel(pageTitle, page.url()),
            fields,
          });
          log(`  Found ${fields.length} field(s) — "${inferFormLabel(pageTitle, page.url())}"`);
        }

        // Only follow links from the entry page to avoid infinite crawling
        if (key === dedupeKey(url)) {
          const formLinks = await discoverFormLinks(page, origin);
          log(`  Found ${formLinks.length} form-related link(s) to follow`);
          for (const link of formLinks) {
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

  return groups;
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
