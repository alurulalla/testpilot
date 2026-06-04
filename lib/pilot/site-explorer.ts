/**
 * Site explorer — crawls a URL and produces a SiteMap.
 *
 * Discovery channels (in priority order):
 *  1. sitemap.xml  — pre-seeds the queue with every URL the site declares
 *  2. <a href>     — classic link-follow crawl
 *  3. pushState    — intercepts history.pushState/replaceState calls that SPAs
 *                    make during their own initialisation, exposing routes that
 *                    have no corresponding <a> tag
 *  4. hash-router  — treats href="#/path" as a real route instead of stripping
 *                    the fragment, enabling discovery on HashRouter SPAs
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
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
} from './crawl-helpers';
import type { SiteMap, PageInfo } from './types';

// ── Crawler tuning ────────────────────────────────────────────────────────────
const NAV_TIMEOUT  = 20_000;  // ms per page load
const IDLE_TIMEOUT =  3_000;  // ms for networkidle

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
  const seen = new Set<string>([dedupeKey(url)]);

  // ── Phase 0: Sitemap pre-seeding ────────────────────────────────────────────
  // Fetch sitemap.xml (via robots.txt hint) and seed the queue so the crawler
  // starts with a full picture of declared routes — especially useful for SPAs
  // that don't link every route from the home page.
  try {
    const origin = new URL(url).origin;
    const sitemapUrls = await fetchSitemapUrls(origin, maxPages * 10, log);
    let seeded = 0;
    for (const sUrl of sitemapUrls) {
      const key = dedupeKey(sUrl);
      if (!seen.has(key) && sameOrigin(sUrl, url)) {
        seen.add(key);
        queue.push({ url: sUrl, depth: 1 }); // treat sitemap URLs as depth-1
        seeded++;
      }
    }
    if (seeded > 0) log(`  [sitemap] +${seeded} URL(s) queued`);
  } catch { /* non-fatal — crawl continues without sitemap */ }

  // ── Phase 1-N: Page-by-page crawl ───────────────────────────────────────────
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

      let actualUrl = pageUrl;
      const page = await ctx.newPage();
      try {
        // Inject pushState listener BEFORE page JS runs so the SPA's own router
        // initialisation is captured.
        await page.addInitScript(PUSHSTATE_INTERCEPT_SCRIPT);

        // 'load' ensures scripts execute (critical for SPAs).
        // Best-effort networkidle waits for React/Vue/Angular first render.
        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        if (resp) pageInfo.status_code = resp.status();
        await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});

        pageInfo.title = await page.title();
        actualUrl = page.url();
        pageInfo.url = actualUrl;
        seen.add(dedupeKey(actualUrl));

        log(`  → "${pageInfo.title}" (${actualUrl})`);

        const slug = urlToSlug(actualUrl);
        const screenshotPath = path.join(snapshotsDir, `explore_${slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        pageInfo.screenshot = screenshotPath;

        pageInfo.elements           = await collectPageElements(page);
        pageInfo.accessibility_tree = await collectAccessibilityTree(page);

        // ── Link discovery ─────────────────────────────────────────────────
        const linkList = (pageInfo.elements as { links?: { href: string }[] }).links ?? [];
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
        // Collect every URL the SPA navigated to during its own init.
        const pushedUrls = await collectPushedUrls(page);
        for (const pu of pushedUrls) enqueue(pu, 'pushState');
        if (pushedUrls.length > 0) {
          log(`  [pushState] ${pushedUrls.length} route(s) observed during page init`);
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
