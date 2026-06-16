/**
 * Authenticated site explorer.
 *
 * Same discovery channels as site-explorer (sitemap, links, pushState, hash-router)
 * but runs with a pre-saved Playwright storageState (cookies + localStorage) so
 * exploration happens as an authenticated user.
 *
 * Produces a SiteMap compatible with runGenerateSuite.
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { SiteMap } from '@/lib/pilot';
import { launchBrowser } from '@/lib/browser';
import {
  sameOrigin,
  urlToSlug,
  dedupeKey,
  resolveLink,
  collectPageElements,
  collectAccessibilityTree,
  fetchSitemapUrls,
  collectPushedUrls,
  PUSHSTATE_INTERCEPT_SCRIPT,
} from '@/lib/pilot/crawl-helpers';

// ── Crawler tuning ────────────────────────────────────────────────────────────
const NAV_TIMEOUT  = 20_000;
const IDLE_TIMEOUT =  3_000;

// ── Main export ───────────────────────────────────────────────────────────────

export interface AuthenticatedSiteExplorerOptions {
  url: string;
  authFile: string;
  depth?: number;
  maxPages?: number;
  outputDir: string;
  onProgress?: (line: string) => void;
  shouldStop?: () => boolean;
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
  const seen = new Set<string>([dedupeKey(url)]);

  // ── Phase 0: Sitemap pre-seeding ────────────────────────────────────────────
  try {
    const origin = new URL(url).origin;
    const sitemapUrls = await fetchSitemapUrls(origin, maxPages * 10, log);
    let seeded = 0;
    for (const sUrl of sitemapUrls) {
      const key = dedupeKey(sUrl);
      if (!seen.has(key) && sameOrigin(sUrl, url)) {
        seen.add(key);
        queue.push({ url: sUrl, depth: 1 });
        seeded++;
      }
    }
    if (seeded > 0) log(`  [sitemap] +${seeded} URL(s) queued`);
  } catch { /* non-fatal */ }

  // ── Phase 1-N: Page-by-page crawl ───────────────────────────────────────────
  const browser = await launchBrowser();
  try {
    // Load storageState so we're already authenticated
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

    while (queue.length > 0 && visited.size < maxPages && !options.shouldStop?.()) {
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

      let actualUrl = pageUrl;
      const page = await ctx.newPage();
      try {
        // Inject pushState listener before any page JS runs
        await page.addInitScript(PUSHSTATE_INTERCEPT_SCRIPT);

        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        if (resp) pageInfo.status_code = resp.status();
        await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});

        pageInfo.title = await page.title();
        actualUrl = page.url();
        pageInfo.url = actualUrl;
        seen.add(dedupeKey(actualUrl));

        log(`  → landed on: ${actualUrl}`);

        const slug = urlToSlug(actualUrl);
        const screenshotPath = path.join(snapshotsDir, `explore_${slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        pageInfo.screenshot = screenshotPath;

        pageInfo.elements           = await collectPageElements(page);
        pageInfo.accessibility_tree = await collectAccessibilityTree(page);

        // ── Link discovery ─────────────────────────────────────────────────
        const linkList = (pageInfo.elements as { links?: { href: string }[] }).links ?? [];
        log(`  → found ${linkList.length} link(s) on page`);

        const childUrls: string[] = [];

        const enqueue = (rawHref: string, source: string) => {
          const fullUrl = resolveLink(rawHref, actualUrl);
          if (!fullUrl) return;
          const key = dedupeKey(fullUrl);
          if (!sameOrigin(fullUrl, url)) return;
          if (seen.has(key)) return;
          if (depth >= maxDepth) return;
          seen.add(key);
          queue.push({ url: fullUrl, depth: depth + 1 });
          childUrls.push(fullUrl);
          log(`  + queued (${source}, depth ${depth + 1}): ${fullUrl}`);
        };

        for (const link of linkList) enqueue(link.href, 'link');

        // ── pushState discovery ────────────────────────────────────────────
        const pushedUrls = await collectPushedUrls(page);
        for (const pu of pushedUrls) enqueue(pu, 'pushState');
        if (pushedUrls.length > 0) {
          log(`  [pushState] ${pushedUrls.length} route(s) observed during page init`);
        }

        if (childUrls.length === 0 && depth < maxDepth) {
          log(`  (no new links or routes to queue from this page)`);
        }
        pageInfo.child_urls = childUrls.slice(0, 10);
      } catch (err) {
        pageInfo.error = err instanceof Error ? err.message : String(err);
        log(`  ⚠ Error scanning ${pageUrl}: ${pageInfo.error}`);
      } finally {
        await page.close().catch(() => {});
      }

      visited.set(actualUrl, pageInfo);
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const pages = Array.from(visited.values()) as SiteMap['pages'];
  const siteMap: SiteMap = { start_url: url, total_pages: pages.length, pages };

  writeFileSync(
    path.join(outputDir, 'site_map.json'),
    JSON.stringify(siteMap, null, 2),
    'utf8',
  );

  return siteMap;
}
