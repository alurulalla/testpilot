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
import { chromium, Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { SiteMap, PageInfo } from './types';

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

async function collectPageElements(page: Page): Promise<Record<string, unknown>> {
  const elements: Record<string, unknown> = {};

  // ── Interactives (primary locator table) ──────────────────────────────────
  // Every visible interactive element with its exact ARIA role + accessible name.
  // This is the definitive reference: role + name → getByRole(role, { name })
  // Priority for accessible name: aria-label > visible text > placeholder > title
  const interactiveSelector =
    "a[href], button:not([disabled]), [role='button'], " +
    "input:not([type='hidden']):not([disabled]), select, textarea, " +
    "[role='link'], [role='menuitem'], [role='tab']";
  const interactiveEls = await page.locator(interactiveSelector).all();
  const interactives: { role: string; name: string; id: string; testId: string; href: string }[] = [];
  for (const el of interactiveEls.slice(0, 100)) {
    if (!await el.isVisible().catch(() => false)) continue;
    const tag         = await el.evaluate((e: Element) => e.tagName.toLowerCase()).catch(() => '');
    const explicitRole = (await el.getAttribute('role').catch(() => '')) || '';
    const inputType   = (await el.getAttribute('type').catch(() => '')) || 'text';

    // Determine the ARIA role
    let role = explicitRole;
    if (!role) {
      if (tag === 'a')        role = 'link';
      else if (tag === 'button' || inputType === 'submit' || inputType === 'button') role = 'button';
      else if (tag === 'select') role = 'combobox';
      else if (tag === 'textarea') role = 'textbox';
      else if (inputType === 'search') role = 'searchbox';
      else if (inputType === 'checkbox') role = 'checkbox';
      else if (inputType === 'radio') role = 'radio';
      else role = 'textbox'; // generic input
    }

    // Accessible name (priority order matching ARIA spec)
    const id      = (await el.getAttribute('id').catch(() => '')) || '';
    const ariaLabel  = (await el.getAttribute('aria-label').catch(() => '')) || '';
    const innerText  = ((await el.innerText().catch(() => '')) || '').trim();
    const placeholder = (await el.getAttribute('placeholder').catch(() => '')) || '';
    const titleAttr  = (await el.getAttribute('title').catch(() => '')) || '';
    // Also check <label for="id"> — many traditional apps (JSP, JSF, Rails) label
    // form inputs this way without using aria-label or placeholder.
    let labelText = '';
    if (id) {
      labelText = (
        await page.locator(`label[for="${id}"]`).first().innerText().catch(() => '')
      || '');
      labelText = labelText.replace(/[*:\s]+$/, '').trim(); // strip trailing asterisks/colons
    }
    const name = (ariaLabel || labelText || innerText || placeholder || titleAttr).replace(/\n+/g, ' ').slice(0, 100);
    if (!name) continue; // skip elements with no discernible name
    const testId = (await el.getAttribute('data-testid').catch(() => ''))
                || (await el.getAttribute('data-test-id').catch(() => ''))
                || (await el.getAttribute('data-cy').catch(() => ''))
                || '';
    // Capture href for <a> links — enables precise href-based locators in tests
    const href = (role === 'link' || tag === 'a')
      ? ((await el.getAttribute('href').catch(() => '')) || '')
      : '';

    interactives.push({ role, name, id, testId, href });
  }
  elements.interactives = interactives;

  // ── Buttons (kept for backward compat, now enriched with aria-label) ──────
  const buttonEls = await page.locator(
    "button, [role='button'], input[type='submit'], input[type='button'], input[type='reset']",
  ).all();
  const buttons: { text: string; ariaLabel: string; id: string }[] = [];
  for (const b of buttonEls) {
    if (!await b.isVisible().catch(() => false)) continue;
    const text      = ((await b.innerText().catch(() => '')) || '').slice(0, 100).trim();
    const ariaLabel = (await b.getAttribute('aria-label').catch(() => '')) || '';
    const id        = (await b.getAttribute('id').catch(() => '')) || '';
    buttons.push({ text, ariaLabel, id });
  }
  elements.buttons = buttons;

  // ── Links (enriched with aria-label) ─────────────────────────────────────
  const linkEls = await page.locator('a[href]').all();
  const links: { text: string; href: string; ariaLabel: string }[] = [];
  for (const a of linkEls.slice(0, 60)) {
    const href = (await a.getAttribute('href').catch(() => '')) || '';
    if (href.startsWith('javascript:') || href.startsWith('#') ||
        href.startsWith('mailto:')     || href.startsWith('tel:')) continue;
    links.push({
      text:      ((await a.innerText().catch(() => '')) || '').slice(0, 80).trim(),
      href,
      ariaLabel: (await a.getAttribute('aria-label').catch(() => '')) || '',
    });
  }
  elements.links = links;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const inputEls = await page.locator("input:not([type='hidden']), textarea, select").all();
  const inputs: Record<string, string>[] = [];
  for (const i of inputEls) {
    if (!await i.isVisible().catch(() => false)) continue;
    inputs.push({
      type:        (await i.getAttribute('type').catch(() => ''))        || 'text',
      name:        (await i.getAttribute('name').catch(() => ''))        || '',
      id:          (await i.getAttribute('id').catch(() => ''))          || '',
      placeholder: (await i.getAttribute('placeholder').catch(() => '')) || '',
      aria_label:  (await i.getAttribute('aria-label').catch(() => ''))  || '',
    });
  }
  elements.inputs = inputs;

  // ── Forms ─────────────────────────────────────────────────────────────────
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

  // ── Headings ──────────────────────────────────────────────────────────────
  const headingEls = await page.locator('h1, h2, h3').all();
  const headings: string[] = [];
  for (const h of headingEls) {
    if (headings.length >= 10) break;
    if (await h.isVisible().catch(() => false)) {
      headings.push(((await h.innerText().catch(() => '')) || '').slice(0, 100).trim());
    }
  }
  elements.headings = headings;

  // ── Landmarks ─────────────────────────────────────────────────────────────
  const landmarkEls = await page.locator(
    "[role='navigation'], [role='main'], [role='banner'], [role='dialog'], nav, main, header, footer",
  ).all();
  const landmarkSet = new Set<string>();
  for (const el of landmarkEls) {
    if (!await el.isVisible().catch(() => false)) continue;
    const role = await el.getAttribute('role').catch(() => null);
    const tag  = await el.evaluate((e: Element) => e.tagName.toLowerCase()).catch(() => '');
    const name = (await el.getAttribute('aria-label').catch(() => '')) || '';
    landmarkSet.add(name ? `${role || tag}[${name}]` : (role || tag));
  }
  elements.landmarks = [...landmarkSet];

  return elements;
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

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    ctx.setDefaultNavigationTimeout(20_000);

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
        // and any initial API calls. Capped at 3s to avoid hanging on
        // long-polling / SSE connections.
        const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: 20_000 });
        if (resp) pageInfo.status_code = resp.status();
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

        pageInfo.title = await page.title();

        // Use actual URL after any server- or client-side redirect
        actualUrl = page.url();
        pageInfo.url = actualUrl;
        seen.add(dedupeKey(actualUrl)); // prevent re-crawling the redirected URL

        log(`  → "${pageInfo.title}" (${actualUrl})`);

        const slug = urlToSlug(actualUrl);
        const screenshotPath = path.join(snapshotsDir, `explore_${slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
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
