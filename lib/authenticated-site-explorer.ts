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
import { Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { SiteMap } from '@/lib/pilot';
import { launchBrowser } from '@/lib/browser';

// ── Vercel-aware tuning ───────────────────────────────────────────────────────
const IS_VERCEL = process.env.VERCEL === '1';
const NAV_TIMEOUT      = IS_VERCEL ?  10_000 : 20_000;
const IDLE_TIMEOUT     = IS_VERCEL ?   1_000 :  3_000;
const FULL_PAGE_SHOT   = !IS_VERCEL;
const MAX_INTERACTIVES = IS_VERCEL ?      40 :    100;
const MAX_LINKS        = IS_VERCEL ?      30 :     60;

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

/**
 * Collect interactive elements, links, inputs, forms, headings and landmarks
 * in a SINGLE page.evaluate() call — eliminates 1000+ Node↔browser round-trips
 * that previously took 30+ seconds on complex pages.
 */
async function collectPageElements(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ maxInteractives, maxLinks }: { maxInteractives: number; maxLinks: number }) => {
      function txt(el: Element): string {
        return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\n+/g, ' ').slice(0, 100);
      }
      function attr(el: Element, name: string): string {
        return el.getAttribute(name) ?? '';
      }
      function isVisible(el: Element): boolean {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
      }

      // ── Interactives ──────────────────────────────────────────────────────
      const intSel = "a[href], button:not([disabled]), [role='button'], " +
        "input:not([type='hidden']):not([disabled]), select, textarea, " +
        "[role='link'], [role='menuitem'], [role='tab']";
      const intEls = [...document.querySelectorAll(intSel)].slice(0, maxInteractives);
      const interactives = intEls.flatMap(el => {
        if (!isVisible(el)) return [];
        const tag  = el.tagName.toLowerCase();
        const type = attr(el, 'type') || 'text';
        const explicitRole = attr(el, 'role');
        const role = explicitRole || (
          tag === 'a' ? 'link' :
          tag === 'button' || type === 'submit' || type === 'button' ? 'button' :
          tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' :
          type === 'search' ? 'searchbox' : type === 'checkbox' ? 'checkbox' :
          type === 'radio' ? 'radio' : 'textbox'
        );
        const id         = attr(el, 'id');
        const ariaLabel  = attr(el, 'aria-label');
        const innerText  = txt(el);
        const placeholder = attr(el, 'placeholder');
        const titleAttr  = attr(el, 'title');
        const labelEl    = id ? document.querySelector(`label[for="${id}"]`) : null;
        const labelText  = labelEl ? txt(labelEl).replace(/[*:\s]+$/, '') : '';
        const name       = (ariaLabel || labelText || innerText || placeholder || titleAttr).slice(0, 100);
        if (!name) return [];
        const testId = attr(el, 'data-testid') || attr(el, 'data-cy') || '';
        const href   = (role === 'link' || tag === 'a') ? attr(el, 'href') : '';
        return [{ role, name, id, testId, href }];
      });

      // ── Buttons ───────────────────────────────────────────────────────────
      const btnSel = "button, [role='button'], input[type='submit'], input[type='button'], input[type='reset']";
      const buttons = [...document.querySelectorAll(btnSel)]
        .filter(isVisible)
        .slice(0, 50)
        .map(b => ({ text: txt(b).slice(0, 100), ariaLabel: attr(b, 'aria-label'), id: attr(b, 'id') }));

      // ── Links ─────────────────────────────────────────────────────────────
      const links = [...document.querySelectorAll('a[href]')]
        .slice(0, maxLinks)
        .map(a => ({ text: txt(a).slice(0, 80), href: attr(a, 'href'), ariaLabel: attr(a, 'aria-label') }))
        .filter(l => !l.href.startsWith('javascript:') && !l.href.startsWith('#') &&
                     !l.href.startsWith('mailto:')     && !l.href.startsWith('tel:'));

      // ── Inputs ────────────────────────────────────────────────────────────
      const inputs = [...document.querySelectorAll("input:not([type='hidden']), textarea, select")]
        .filter(isVisible)
        .map(i => ({
          type:        attr(i, 'type') || 'text',
          name:        attr(i, 'name'),
          id:          attr(i, 'id'),
          placeholder: attr(i, 'placeholder'),
          aria_label:  attr(i, 'aria-label'),
        }));

      // ── Forms ─────────────────────────────────────────────────────────────
      const forms = [...document.querySelectorAll('form')].map(f => ({
        action: attr(f, 'action'),
        method: (attr(f, 'method') || 'get').toUpperCase(),
        id:     attr(f, 'id'),
      }));

      // ── Headings ──────────────────────────────────────────────────────────
      const headings = [...document.querySelectorAll('h1, h2, h3')]
        .filter(isVisible)
        .slice(0, 10)
        .map(h => txt(h))
        .filter(Boolean);

      // ── Landmarks ─────────────────────────────────────────────────────────
      const landmarkSel = "[role='navigation'],[role='main'],[role='banner'],[role='dialog'],nav,main,header,footer";
      const landmarks = [...new Set(
        [...document.querySelectorAll(landmarkSel)]
          .filter(isVisible)
          .map(el => {
            const r = attr(el, 'role') || el.tagName.toLowerCase();
            const n = attr(el, 'aria-label');
            return n ? `${r}[${n}]` : r;
          }),
      )];

      return { interactives, buttons, links, inputs, forms, headings, landmarks };
    },
    { maxInteractives: MAX_INTERACTIVES, maxLinks: MAX_LINKS },
  ).catch(() => ({}));
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

  const browser = await launchBrowser();
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
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);

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
        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        if (resp) pageInfo.status_code = resp.status();

        // Best-effort networkidle: waits for React/Vue/Angular to finish its first
        // render + any initial API calls. Capped to avoid hanging on long-polling/SSE.
        await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});

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
        await page.screenshot({ path: screenshotPath, fullPage: FULL_PAGE_SHOT }).catch(() => {});
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
