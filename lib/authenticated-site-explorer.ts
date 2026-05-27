/**
 * Authenticated site explorer.
 *
 * Used when the user has pre-logged-in and saved a Playwright storageState
 * to auth.json. Loads those cookies/localStorage so exploration happens as
 * an authenticated user.
 *
 * Produces a SiteMap in the same format as runSiteExplorer (lib/pilot)
 * so it is compatible with runGenerateSuite.
 */
import { chromium, Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { SiteMap } from '@/lib/pilot';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function urlToSlug(url: string, maxLen = 60): string {
  let slug = url.replace('://', '_').replace(/\//g, '_').replace(/\?/g, '_').replace(/=/g, '_');
  slug = slug.split('_').filter(Boolean).join('_');
  return slug.slice(0, maxLen);
}

/**
 * Produce a stable deduplication key for a URL by stripping:
 *  - ;jsessionid=… and any other ;param= path extensions (Java sessions)
 *  - query string (session tokens, nonces)
 *  - hash fragment
 */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/;[^/?#]*/g, '');
    return u.origin + path;
  } catch {
    return url.split('?')[0].split('#')[0].replace(/;[^/?#]*/g, '');
  }
}

async function collectPageElements(page: Page): Promise<Record<string, unknown>> {
  const elements: Record<string, unknown> = {};

  // Buttons
  const buttonEls = await page.locator(
    "button, [role='button'], input[type='submit'], input[type='button'], input[type='reset']",
  ).all();
  const buttons: string[] = [];
  for (const b of buttonEls) {
    if (await b.isVisible()) {
      const t = ((await b.innerText().catch(() => '')) || '').slice(0, 100).trim();
      buttons.push(t);
    }
  }
  elements.buttons = buttons;

  // Links
  const linkEls = await page.locator('a[href]').all();
  const links: { text: string; href: string }[] = [];
  for (const a of linkEls.slice(0, 50)) {
    const href = (await a.getAttribute('href').catch(() => '')) || '';
    if (href.startsWith('javascript:') || href.startsWith('#') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    links.push({
      text: ((await a.innerText().catch(() => '')) || '').slice(0, 80).trim(),
      href,
    });
  }
  elements.links = links;

  // Inputs
  const inputEls = await page.locator("input:not([type='hidden']), textarea, select").all();
  const inputs: Record<string, string>[] = [];
  for (const i of inputEls) {
    if (!await i.isVisible().catch(() => false)) continue;
    inputs.push({
      type: (await i.getAttribute('type').catch(() => '')) || 'text',
      name: (await i.getAttribute('name').catch(() => '')) || '',
      id:   (await i.getAttribute('id').catch(() => '')) || '',
      placeholder: (await i.getAttribute('placeholder').catch(() => '')) || '',
      aria_label:  (await i.getAttribute('aria-label').catch(() => '')) || '',
    });
  }
  elements.inputs = inputs;

  // Forms
  const formEls = await page.locator('form').all();
  const forms: Record<string, string>[] = [];
  for (const f of formEls) {
    forms.push({
      action: (await f.getAttribute('action').catch(() => '')) || '',
      method: ((await f.getAttribute('method').catch(() => '')) || 'get').toUpperCase(),
      id:     (await f.getAttribute('id').catch(() => '')) || '',
    });
  }
  elements.forms = forms;

  // Headings
  const headingEls = await page.locator('h1, h2, h3').all();
  const headings: string[] = [];
  for (const h of headingEls) {
    if (headings.length >= 10) break;
    if (await h.isVisible().catch(() => false)) {
      headings.push(((await h.innerText().catch(() => '')) || '').slice(0, 100).trim());
    }
  }
  elements.headings = headings;

  // Landmarks
  const landmarkEls = await page.locator(
    "[role='navigation'], [role='main'], [role='banner'], [role='dialog'], nav, main, header, footer",
  ).all();
  const landmarkSet = new Set<string>();
  for (const el of landmarkEls) {
    if (!await el.isVisible().catch(() => false)) continue;
    const role = await el.getAttribute('role').catch(() => null);
    const tag  = await el.evaluate((e: Element) => (e as HTMLElement).tagName.toLowerCase()).catch(() => '');
    landmarkSet.add(role || tag);
  }
  elements.landmarks = [...landmarkSet];

  return elements;
}

async function collectAccessibilityTree(page: Page): Promise<unknown> {
  try {
    const snap = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => null);
    if (!snap) return null;
    // Return raw string — generator handles both string and parsed-object formats
    return snap;
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface AuthenticatedSiteExplorerOptions {
  url: string;
  authFile: string;
  depth?: number;
  maxPages?: number;
  outputDir: string;
  onProgress?: (line: string) => void;
}

export async function runAuthenticatedSiteExplorer(
  options: AuthenticatedSiteExplorerOptions,
): Promise<SiteMap> {
  const {
    url,
    authFile,
    depth: maxDepth = 2,
    maxPages = 10,
    outputDir,
    onProgress,
  } = options;

  const log = (msg: string) => onProgress?.(msg);
  const snapshotsDir = path.join(outputDir, 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });

  const visited = new Map<string, unknown>();
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
  // seen uses normalised dedup keys so jsessionid-rotation doesn't cause
  // the same logical page to be crawled multiple times with different IDs
  const seen = new Set<string>([dedupeKey(url)]);

  const browser = await chromium.launch({ headless: true });
  try {
    // ← This is the key difference: load storageState so we're already logged in
    const ctx = await browser.newContext({
      storageState: authFile,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    ctx.setDefaultNavigationTimeout(20_000);

    while (queue.length > 0 && visited.size < maxPages) {
      const next = queue.shift()!;
      const { url: pageUrl, depth } = next;

      log(`  [explore] ${pageUrl}`);

      const pageInfo: Record<string, unknown> = {
        url:               pageUrl,
        depth,
        title:             '',
        status_code:       null,
        elements:          {},
        accessibility_tree: null,
        child_urls:        [],
        screenshot:        '',
        error:             null,
      };

      // Hoist actualUrl so it's accessible outside the try block (for visited.set)
      let actualUrl = pageUrl;
      const page = await ctx.newPage();
      try {
        // 'load' waits for scripts to execute — critical for React/Vue/Angular SPAs
        // where 'domcontentloaded' fires before the framework renders navigation links.
        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: 20_000 });
        if (resp) pageInfo.status_code = resp.status();

        // Best-effort networkidle: waits for React/Vue/Angular to finish its first
        // render + any initial API calls. Capped at 3 s so we never hang on
        // long-polling / SSE connections (parabank, etc.).
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

        pageInfo.title = await page.title();

        // Use the ACTUAL page URL after any client-side redirect as the base for
        // relative-link resolution. E.g. https://www.saucedemo.com → /inventory.html
        actualUrl = page.url();
        pageInfo.url = actualUrl;

        log(`  → landed on: ${actualUrl}`);

        // Register the actual (post-redirect) URL in seen so that links pointing
        // back to /inventory.html are not re-queued.
        seen.add(dedupeKey(actualUrl));

        const slug = urlToSlug(actualUrl);
        const screenshotPath = path.join(snapshotsDir, `explore_${slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        pageInfo.screenshot = screenshotPath;

        pageInfo.elements          = await collectPageElements(page);
        pageInfo.accessibility_tree = await collectAccessibilityTree(page);

        // Discover child links — resolve relative hrefs against actualUrl
        const linkList = (pageInfo.elements as { links?: { href: string }[] }).links ?? [];
        log(`  → found ${linkList.length} link(s) on page`);

        const childUrls: string[] = [];
        for (const link of linkList) {
          let fullUrl: string;
          try {
            fullUrl = new URL(link.href, actualUrl).href.split('#')[0];
          } catch {
            continue;
          }
          const key = dedupeKey(fullUrl);
          if (!sameOrigin(fullUrl, url)) continue;          // external domain — skip
          if (seen.has(key)) continue;                      // already visited / queued
          if (depth >= maxDepth) continue;                  // max depth reached

          seen.add(key);
          queue.push({ url: fullUrl, depth: depth + 1 });
          childUrls.push(fullUrl);
          log(`  + queued (depth ${depth + 1}): ${fullUrl}`);
        }
        if (childUrls.length === 0 && depth < maxDepth) {
          log(`  (no new links to queue from this page)`);
        }
        pageInfo.child_urls = childUrls.slice(0, 10);
      } catch (err) {
        pageInfo.error = err instanceof Error ? err.message : String(err);
        log(`  ⚠ Error scanning ${pageUrl}: ${pageInfo.error}`);
      } finally {
        await page.close().catch(() => {});
      }

      // Key by actualUrl so the same page isn't recorded twice if queued under
      // different surface URLs (e.g. origin + redirected path).
      visited.set(actualUrl, pageInfo);
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const pages = Array.from(visited.values()) as SiteMap['pages'];
  const siteMap: SiteMap = {
    start_url: url,
    total_pages: pages.length,
    pages,
  };

  // Write site_map.json so runGenerateSuite (with skipExplore: true) can find it
  writeFileSync(
    path.join(outputDir, 'site_map.json'),
    JSON.stringify(siteMap, null, 2),
    'utf8',
  );

  return siteMap;
}
