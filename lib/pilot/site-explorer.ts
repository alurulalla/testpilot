/**
 * Site explorer — crawls a URL and produces a SiteMap.
 *
 * Improvements over previous npm-based crawlers:
 *  - waitUntil:'load' + best-effort networkidle(3s) instead of a hard
 *    networkidle timeout that hangs on polling / SSE connections.
 *  - dedupeKey() strips ;jsessionid= path parameters and query strings
 *    so Java-session-rotated URLs are not re-crawled as separate pages.
 *  - Uses page.url() (actual URL after any server/client redirect) as
 *    the base for relative-link resolution.
 *  - Verbose progress logging so every queued URL is visible in the UI.
 */
import { Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchBrowser } from '@/lib/browser';
import type { SiteMap, PageInfo } from './types';

// ── Vercel-aware tuning ───────────────────────────────────────────────────────
// On Vercel serverless the CPU is slower, memory is tighter, and the Lambda
// has a hard timeout.  Use more aggressive limits to stay within budget.
const IS_VERCEL = process.env.VERCEL === '1';
const NAV_TIMEOUT      = IS_VERCEL ?  10_000 : 20_000;  // ms per page load
const IDLE_TIMEOUT     = IS_VERCEL ?   1_000 :  3_000;  // ms for networkidle
const FULL_PAGE_SHOT   = !IS_VERCEL;                     // full-page is slow on Lambda
const MAX_INTERACTIVES = IS_VERCEL ?      40 :    100;   // elements to inspect
const MAX_LINKS        = IS_VERCEL ?      30 :     60;   // links to extract

// ── Helpers ───────────────────────────────────────────────────────────────────

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function urlToSlug(url: string, maxLen = 60): string {
  let slug = url.replace('://', '_').replace(/\//g, '_').replace(/\?/g, '_').replace(/=/g, '_');
  slug = slug.split('_').filter(Boolean).join('_');
  return slug.slice(0, maxLen);
}

/**
 * Stable dedup key: strips ;jsessionid= (and any ;param=) path extensions,
 * query strings, and hash fragments so the same logical page with rotating
 * session IDs is not crawled multiple times.
 */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const cleanPath = u.pathname.replace(/;[^/?#]*/g, '');
    return u.origin + cleanPath;
  } catch {
    return url.split('?')[0].split('#')[0].replace(/;[^/?#]*/g, '');
  }
}

// ── Page-level scrapers ───────────────────────────────────────────────────────

/**
 * Collect interactive elements, links, inputs, forms, headings and landmarks
 * from the current page.
 *
 * All DOM queries run in a SINGLE page.evaluate() call to avoid the per-call
 * Node↔browser round-trip overhead (which is 5-20 ms per call and adds up to
 * minutes on complex pages like YouTube or Accenture.com).
 */
async function collectPageElements(
  page: Page,
): Promise<Record<string, unknown>> {
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

      // ── Interactives ────────────────────────────────────────────────────────
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

      // ── Buttons ─────────────────────────────────────────────────────────────
      const btnSel = "button, [role='button'], input[type='submit'], input[type='button'], input[type='reset']";
      const buttons = [...document.querySelectorAll(btnSel)]
        .filter(isVisible)
        .slice(0, 50)
        .map(b => ({ text: txt(b).slice(0, 100), ariaLabel: attr(b, 'aria-label'), id: attr(b, 'id') }));

      // ── Links ────────────────────────────────────────────────────────────────
      const links = [...document.querySelectorAll('a[href]')]
        .slice(0, maxLinks)
        .map(a => ({ text: txt(a).slice(0, 80), href: attr(a, 'href'), ariaLabel: attr(a, 'aria-label') }))
        .filter(l => !l.href.startsWith('javascript:') && !l.href.startsWith('#') &&
                     !l.href.startsWith('mailto:')     && !l.href.startsWith('tel:'));

      // ── Inputs ───────────────────────────────────────────────────────────────
      const inputs = [...document.querySelectorAll("input:not([type='hidden']), textarea, select")]
        .filter(isVisible)
        .map(i => ({
          type:        attr(i, 'type') || 'text',
          name:        attr(i, 'name'),
          id:          attr(i, 'id'),
          placeholder: attr(i, 'placeholder'),
          aria_label:  attr(i, 'aria-label'),
        }));

      // ── Forms ────────────────────────────────────────────────────────────────
      const forms = [...document.querySelectorAll('form')].map(f => ({
        action: attr(f, 'action'),
        method: (attr(f, 'method') || 'get').toUpperCase(),
        id:     attr(f, 'id'),
      }));

      // ── Headings ─────────────────────────────────────────────────────────────
      const headings = [...document.querySelectorAll('h1, h2, h3')]
        .filter(isVisible)
        .slice(0, 10)
        .map(h => txt(h))
        .filter(Boolean);

      // ── Landmarks ────────────────────────────────────────────────────────────
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
    return snap ?? null;
  } catch {
    return null;
  }
}

// ── Main crawler ──────────────────────────────────────────────────────────────

export interface RunSiteExplorerOptions {
  url: string;
  depth?: number;
  maxPages?: number;
  writeSiteMap?: boolean;
  outputDir?: string;
  onProgress?: (line: string) => void;
}

export async function runSiteExplorer(options: RunSiteExplorerOptions): Promise<SiteMap> {
  const {
    url,
    depth: maxDepth = 2,
    maxPages = 10,
    writeSiteMap: doWrite = true,
    outputDir,
    onProgress,
  } = options;

  const log = (msg: string) => onProgress ? onProgress(msg) : console.log(msg);

  const snapshotsDir = outputDir
    ? path.join(outputDir, 'snapshots')
    : path.join(process.cwd(), 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });

  const visited = new Map<string, PageInfo>();
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
  // seen uses dedup keys so jsessionid-rotation doesn't cause duplicate crawls
  const seen = new Set<string>([dedupeKey(url)]);

  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);

    while (queue.length > 0 && visited.size < maxPages) {
      const next = queue.shift()!;
      const { url: pageUrl, depth } = next;

      log(`  [${String(visited.size + 1).padStart(3)}/${maxPages}] depth=${depth} ${pageUrl}`);

      const pageInfo: PageInfo = {
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

      // Hoist actualUrl so it's accessible outside the try block
      let actualUrl = pageUrl;
      const page = await ctx.newPage();
      try {
        // 'load' ensures scripts execute (critical for SPAs).
        // Then best-effort networkidle waits for React/Vue/Angular first render
        // and any initial API calls. Capped to avoid hanging on long-polling / SSE.
        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        if (resp) pageInfo.status_code = resp.status();
        await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});

        pageInfo.title = await page.title();

        // Use actual URL after any server- or client-side redirect
        actualUrl = page.url();
        pageInfo.url = actualUrl;
        seen.add(dedupeKey(actualUrl)); // prevent re-crawling the redirected URL

        log(`  → "${pageInfo.title}" (${actualUrl})`);

        const slug = urlToSlug(actualUrl);
        const screenshotPath = path.join(snapshotsDir, `explore_${slug}.png`);
        // fullPage screenshots are very slow on heavy SPAs (YouTube, etc.) on Vercel
        await page.screenshot({ path: screenshotPath, fullPage: FULL_PAGE_SHOT }).catch(() => {});
        pageInfo.screenshot = screenshotPath;

        pageInfo.elements          = await collectPageElements(page);
        pageInfo.accessibility_tree = await collectAccessibilityTree(page);

        // Discover child links
        const linkList = (pageInfo.elements as { links?: { href: string }[] }).links ?? [];
        const childUrls: string[] = [];

        for (const link of linkList) {
          let fullUrl: string;
          try {
            fullUrl = new URL(link.href, actualUrl).href.split('#')[0];
          } catch {
            continue;
          }
          const key = dedupeKey(fullUrl);
          if (!sameOrigin(fullUrl, url)) continue;
          if (seen.has(key)) continue;
          if (depth >= maxDepth) continue;

          seen.add(key);
          queue.push({ url: fullUrl, depth: depth + 1 });
          childUrls.push(fullUrl);
          log(`  + queued (depth ${depth + 1}): ${fullUrl}`);
        }

        pageInfo.child_urls = childUrls.slice(0, 10);
      } catch (err) {
        pageInfo.error = err instanceof Error ? err.message : String(err);
        log(`  ⚠ Error on ${pageUrl}: ${pageInfo.error}`);
      } finally {
        await page.close().catch(() => {});
      }

      visited.set(actualUrl, pageInfo);
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const pages = Array.from(visited.values());
  const siteMap: SiteMap = { start_url: url, total_pages: pages.length, pages };

  if (doWrite) {
    const file = outputDir
      ? path.join(outputDir, 'site_map.json')
      : path.join(process.cwd(), 'site_map.json');
    if (outputDir) mkdirSync(outputDir, { recursive: true });
    writeFileSync(file, JSON.stringify(siteMap, null, 2), 'utf8');
  }

  return siteMap;
}
