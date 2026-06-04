/**
 * Nav-Click Explorer — doc-guided click-based route discovery.
 *
 * After the standard crawl, some features mentioned in the product documentation
 * may still be missing from the sitemap (behind a dropdown, a sidebar link, a
 * tab panel, etc.).  This module:
 *
 *  1. Loads the start URL (authenticated if authFile is provided).
 *  2. Collects every visible navigation element on the page.
 *  3. Scores each nav element against every missing feature name.
 *  4. Clicks the best-matching element for each missing feature.
 *  5. If the URL changes after the click, records the new page.
 *  6. Returns the newly discovered pages so the loop can add them to the sitemap.
 *
 * This runs as Phase 1.6 — between the crawl (Phase 1) and test generation (Phase 2).
 */

import type { Page, BrowserContext } from 'playwright';
import { launchBrowser } from '@/lib/browser';
import {
  collectPageElements,
  collectAccessibilityTree,
  dedupeKey,
  sameOrigin,
  PUSHSTATE_INTERCEPT_SCRIPT,
} from './crawl-helpers';
import type { PageInfo } from './types';

// ── Tuning ────────────────────────────────────────────────────────────────────

const NAV_TIMEOUT      = 20_000;
const IDLE_TIMEOUT     =  3_000;
const CLICK_SETTLE_MS  =  2_000; // wait after click for SPA to settle
const MAX_CLICKS       =    30;  // safety cap on total clicks per session

// ── Feature ↔ nav-label matching ─────────────────────────────────────────────

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'is', 'are', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'its', 'it', 'be', 'was',
  'page', 'section', 'view', 'module', 'tab', 'panel',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score how well a nav label matches a feature name.
 * Returns 0–1 (1 = perfect match).
 */
export function scoreMatch(navLabel: string, featureName: string): number {
  const navTokens  = new Set(tokenise(navLabel));
  const featTokens = tokenise(featureName);
  if (featTokens.length === 0 || navTokens.size === 0) return 0;

  const shared = featTokens.filter(t => navTokens.has(t)).length;
  // Jaccard-like: shared / union
  const union = new Set([...navTokens, ...featTokens]).size;
  return shared / union;
}

/**
 * For each missing feature, find the best-matching nav element handle.
 * Returns a map of featureName → { label, selector, score }.
 */
function matchFeaturesToNavItems(
  navItems: NavItem[],
  missingFeatures: string[],
  threshold = 0.15,
): Map<string, NavItem & { score: number }> {
  const result = new Map<string, NavItem & { score: number }>();

  for (const feature of missingFeatures) {
    let best: (NavItem & { score: number }) | null = null;
    for (const item of navItems) {
      const score = scoreMatch(item.label, feature);
      if (score >= threshold && (!best || score > best.score)) {
        best = { ...item, score };
      }
    }
    if (best) result.set(feature, best);
  }
  return result;
}

// ── Nav-item collection ───────────────────────────────────────────────────────

interface NavItem {
  label: string;
  /** CSS selector to locate the element for clicking */
  selector: string;
  /** The href if this is a link (may be relative) */
  href?: string;
}

/**
 * Extract all visible navigation elements from the current page.
 * Focuses on primary navigation areas but falls back to any visible link/button.
 */
async function collectNavItems(page: Page): Promise<NavItem[]> {
  return page.evaluate(() => {
    function txt(el: Element): string {
      return ((el as HTMLElement).innerText ?? el.textContent ?? '')
        .trim().replace(/\n+/g, ' ').slice(0, 80);
    }
    function isVisible(el: Element): boolean {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' &&
             (el as HTMLElement).offsetParent !== null;
    }
    function uniqueSelector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const t = txt(el).slice(0, 30).replace(/['"]/g, '');
      if (t) return `${tag}:has-text("${t}")`;
      return tag;
    }

    const seen = new Set<string>();
    const items: { label: string; selector: string; href?: string }[] = [];

    // Priority: nav elements first, then any link/button
    const selectors = [
      "nav a, nav button, [role='navigation'] a, [role='navigation'] button",
      "header a, header button, [role='banner'] a",
      "aside a, [role='complementary'] a, .sidebar a",
      "[role='menubar'] [role='menuitem'], [role='menu'] [role='menuitem']",
      "[role='tablist'] [role='tab']",
      "a[href], button",
    ];

    for (const sel of selectors) {
      for (const el of [...document.querySelectorAll(sel)]) {
        if (!isVisible(el)) continue;
        const label = txt(el);
        if (!label || label.length < 2) continue;
        if (seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());

        const href = el.getAttribute('href') ?? undefined;
        if (href && (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:'))) continue;

        items.push({ label, selector: uniqueSelector(el), href });
        if (items.length >= 80) break;
      }
      if (items.length >= 80) break;
    }
    return items;
  }).catch(() => []);
}

// ── Single-page click & capture ───────────────────────────────────────────────

/**
 * Click a nav item and capture the page we land on.
 * Returns null if the URL didn't change (dropdown opened, nothing navigated).
 */
async function clickAndCapture(
  ctx: BrowserContext,
  startUrl: string,
  navItem: NavItem,
  alreadySeen: Set<string>,
  baseUrl: string,
  log: (msg: string) => void,
): Promise<PageInfo | null> {
  const page = await ctx.newPage();
  try {
    await page.addInitScript(PUSHSTATE_INTERCEPT_SCRIPT);
    await page.goto(startUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});

    const beforeUrl = page.url();

    // Find and click the nav element
    const el = page.locator(navItem.selector).first();
    const isVisible = await el.isVisible().catch(() => false);
    if (!isVisible) {
      // Fallback: find by text
      const byText = page.getByText(navItem.label, { exact: false }).first();
      const textVisible = await byText.isVisible().catch(() => false);
      if (!textVisible) return null;
      await byText.click({ timeout: 5_000 }).catch(() => {});
    } else {
      await el.click({ timeout: 5_000 }).catch(() => {});
    }

    // Wait for SPA to settle after click
    await page.waitForLoadState('networkidle', { timeout: CLICK_SETTLE_MS }).catch(() => {});
    await page.waitForTimeout(500);

    const afterUrl = page.url();

    // No navigation happened (dropdown opened, modal, etc.) — skip
    if (dedupeKey(afterUrl) === dedupeKey(beforeUrl)) return null;
    // External domain — skip
    if (!sameOrigin(afterUrl, baseUrl)) return null;
    // Already in sitemap — skip
    if (alreadySeen.has(dedupeKey(afterUrl))) return null;

    log(`  [click-nav] "${navItem.label}" → ${afterUrl}`);

    const title = await page.title();
    const elements = await collectPageElements(page);
    const accessibility_tree = await collectAccessibilityTree(page);

    return {
      url:   afterUrl,
      depth: 99, // marker: discovered via click-nav
      title,
      status_code: 200,
      elements,
      accessibility_tree,
      child_urls: [],
      screenshot: '',
      error: null,
    };
  } catch (err) {
    log(`  [click-nav] failed to click "${navItem.label}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface NavClickExplorerOptions {
  /** URL to load navigation from (authenticated post-login URL if applicable). */
  startUrl: string;
  /** Optional Playwright storageState file for authenticated sessions. */
  authFile?: string;
  /** Feature names from the product doc that weren't found in the crawl. */
  missingFeatures: string[];
  /** The sitemap produced by Phase 1 — used to avoid re-visiting known pages.
   *  Accepts any object with a `pages` array that has `url` strings. */
  existingSiteMap: { pages: { url: string }[] };
  onProgress?: (msg: string) => void;
}

export interface NavClickExplorerResult {
  /** New pages discovered via navigation clicks. */
  discoveredPages: PageInfo[];
  /** Features that led to at least one new page. */
  foundFeatures: string[];
  /** Features for which no matching nav element was found or navigation failed. */
  missedFeatures: string[];
}

export async function runNavClickExplorer(
  options: NavClickExplorerOptions,
): Promise<NavClickExplorerResult> {
  const { startUrl, authFile, missingFeatures, existingSiteMap, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  if (missingFeatures.length === 0) {
    return { discoveredPages: [], foundFeatures: [], missedFeatures: [] };
  }

  // Build a set of already-known page keys so we don't re-add them
  const knownKeys = new Set(
    existingSiteMap.pages.map(p => dedupeKey(p.url)),
  );

  const discoveredPages: PageInfo[]  = [];
  const foundFeatures:   string[]    = [];
  const missedFeatures:  string[]    = [];
  const clickCount                   = { n: 0 };

  const browser = await launchBrowser();
  try {
    const ctxOpts = {
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      ...(authFile ? { storageState: authFile } : {}),
    };
    const ctx = await browser.newContext(ctxOpts);
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);

    // ── Step 1: Collect nav items from the start URL ──────────────────────
    log(`  [click-nav] Collecting navigation elements from ${startUrl}…`);
    const probePage = await ctx.newPage();
    let navItems: NavItem[] = [];
    try {
      await probePage.goto(startUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
      await probePage.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT }).catch(() => {});
      navItems = await collectNavItems(probePage);
      log(`  [click-nav] Found ${navItems.length} navigation element(s)`);
    } finally {
      await probePage.close().catch(() => {});
    }

    if (navItems.length === 0) {
      return { discoveredPages: [], foundFeatures: [], missedFeatures: [...missingFeatures] };
    }

    // ── Step 2: Match missing features to nav items ───────────────────────
    const matches = matchFeaturesToNavItems(navItems, missingFeatures);

    for (const feature of missingFeatures) {
      const match = matches.get(feature);
      if (!match) {
        log(`  [click-nav] No nav match found for: "${feature}"`);
        missedFeatures.push(feature);
        continue;
      }

      if (clickCount.n >= MAX_CLICKS) {
        log(`  [click-nav] Max clicks (${MAX_CLICKS}) reached — skipping remaining features`);
        missedFeatures.push(feature);
        continue;
      }

      log(`  [click-nav] "${feature}" → trying "${match.label}" (score: ${match.score.toFixed(2)})`);
      clickCount.n++;

      const newPage = await clickAndCapture(ctx, startUrl, match, knownKeys, startUrl, log);
      if (newPage) {
        knownKeys.add(dedupeKey(newPage.url));
        discoveredPages.push(newPage);
        foundFeatures.push(feature);
      } else {
        log(`  [click-nav] "${match.label}" did not navigate to a new page`);
        missedFeatures.push(feature);
      }
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  return { discoveredPages, foundFeatures, missedFeatures };
}
