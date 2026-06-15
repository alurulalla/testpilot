/**
 * Shared crawl helpers — used by both site-explorer and authenticated-site-explorer.
 *
 * Provides:
 *  - Common utilities  : sameOrigin, urlToSlug, dedupeKey (hash-router aware)
 *  - DOM collectors    : collectPageElements, collectAccessibilityTree
 *  - Sitemap discovery : fetchSitemapUrls  (robots.txt → sitemap.xml → <loc> parse)
 *  - pushState capture : getPushStateScript, collectPushedUrls
 *  - Link resolution   : resolveLink (preserves hash-router #/path fragments)
 */
import type { Page } from 'playwright';

// ── Common utilities ──────────────────────────────────────────────────────────

export function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

export function urlToSlug(url: string, maxLen = 60): string {
  let slug = url.replace('://', '_').replace(/\//g, '_').replace(/\?/g, '_').replace(/=/g, '_');
  slug = slug.split('_').filter(Boolean).join('_');
  return slug.slice(0, maxLen);
}

/**
 * Stable deduplication key that strips:
 *  - ;jsessionid= (and any ;param=) path extensions
 *  - query strings (session tokens, nonces, etc.)
 *  - plain anchor fragments  (#section-id)
 *
 * but PRESERVES hash-router paths (#/route) as part of the page identity,
 * so React Router / Vue Router HashRouter routes are treated as distinct pages.
 */
export function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const cleanPath = u.pathname.replace(/;[^/?#]*/g, '');
    // Keep hash-router fragments (#/route) but drop plain anchor fragments (#section)
    const hashPart = u.hash.startsWith('#/') ? u.hash : '';
    return u.origin + cleanPath + hashPart;
  } catch {
    return url.split('?')[0].replace(/;[^/?#]*/g, '');
  }
}

/**
 * Normalise a URL into a path "pattern" by replacing variable-looking path
 * segments (numeric ids, UUIDs, long hashes/slugs) with ":id".
 *
 *   /product/1234        → /product/:id
 *   /users/abc-uuid/edit → /users/:id/edit
 *   /blog/some-post-2024 → /blog/:id   (long slug segments collapse too)
 *
 * Used to detect templated routes so the crawler samples a few examples per
 * pattern instead of exhausting the page budget on near-identical pages.
 */
export function pathPattern(url: string): string {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { pathname = url; }
  const segs = pathname.split('/').filter(Boolean).map(seg => {
    if (/^\d+$/.test(seg)) return ':id';                                  // pure number
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg)) return ':id';          // uuid
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';                       // long hash
    if (/\d/.test(seg) && seg.length > 12) return ':id';                  // long mixed slug
    return seg.toLowerCase();
  });
  return '/' + segs.join('/');
}

/**
 * Resolve a link href against the current page URL.
 *
 * Rules:
 *  - javascript: / mailto: / tel:  → skip (return null)
 *  - href="#/path"                 → hash-router route → keep as origin + "/#/path"
 *  - href="#section"               → plain anchor       → skip
 *  - everything else               → standard URL resolution, strip plain #anchors
 */
export function resolveLink(href: string, base: string): string | null {
  if (!href) return null;
  if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;

  if (href.startsWith('#')) {
    // hash-router path: #/dashboard, #/settings, etc.
    if (href.slice(1).startsWith('/')) {
      try {
        const origin = new URL(base).origin;
        return `${origin}/${href}`; // → http://example.com/#/dashboard
      } catch { return null; }
    }
    return null; // plain anchor like #contact — skip
  }

  try {
    const resolved = new URL(href, base).href;
    const u = new URL(resolved);
    // Preserve hash-router fragments on the resolved URL
    if (u.hash.startsWith('#/')) return resolved;
    // Strip plain anchor fragments
    return resolved.split('#')[0];
  } catch {
    return null;
  }
}

// ── DOM collectors ────────────────────────────────────────────────────────────

const MAX_INTERACTIVES = 100;
const MAX_LINKS        =  60;

/**
 * Collect interactive elements, links, inputs, forms, headings, and landmarks
 * from the current page in a SINGLE page.evaluate() call.
 *
 * Links filter: keeps href="#/path" (hash-router) but drops href="#anchor".
 */
export async function collectPageElements(page: Page): Promise<Record<string, unknown>> {
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

      // Role/name derivation shared by extraction AND the duplicate-count pass, so
      // the counts match exactly what we emit (and what Playwright would resolve).
      const intRole = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const type = attr(el, 'type') || 'text';
        return attr(el, 'role') || (
          tag === 'a' ? 'link' :
          tag === 'button' || type === 'submit' || type === 'button' ? 'button' :
          tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' :
          type === 'search' ? 'searchbox' : type === 'checkbox' ? 'checkbox' :
          type === 'radio' ? 'radio' : 'textbox'
        );
      };
      const intName = (el: Element): string => {
        const id = attr(el, 'id');
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        const labelText = labelEl ? txt(labelEl).replace(/[*:\s]+$/, '') : '';
        return (attr(el, 'aria-label') || labelText || txt(el) || attr(el, 'placeholder') || attr(el, 'title')).slice(0, 100);
      };

      // Duplicate-count pass over ALL candidates (not just the visible/sliced set)
      // so a locator's uniqueness reflects what Playwright strict mode actually
      // sees. Same role+name (header/mega-menu/footer copies) or the same href →
      // an ambiguous locator that throws on >1 match. We record the count + the
      // element's index so the generator can pin it with .nth()/.first().
      const allInt = [...document.querySelectorAll(intSel)];
      const rnCount = new Map<string, number>();   // role+name → total count
      const rnNth   = new WeakMap<Element, number>(); // element → index among same role+name
      for (const el of allInt) {
        const nm = intName(el);
        if (!nm) continue;
        const k = intRole(el) + '\n' + nm;
        const i = rnCount.get(k) || 0;
        rnNth.set(el, i);
        rnCount.set(k, i + 1);
      }
      const hrefCount = new Map<string, number>();
      for (const a of [...document.querySelectorAll('a[href]')]) {
        const h = attr(a, 'href');
        if (h) hrefCount.set(h, (hrefCount.get(h) || 0) + 1);
      }

      const intEls = allInt.slice(0, maxInteractives);
      const interactives = intEls.flatMap(el => {
        if (!isVisible(el)) return [];
        const role = intRole(el);
        const name = intName(el);
        if (!name) return [];
        const tag    = el.tagName.toLowerCase();
        const id     = attr(el, 'id');
        const testId = attr(el, 'data-testid') || attr(el, 'data-cy') || '';
        const href   = (role === 'link' || tag === 'a') ? attr(el, 'href') : '';
        const dupe   = (rnCount.get(role + '\n' + name) || 0) > 1;
        return [{
          role, name, id, testId, href, dupe,
          nth: dupe ? (rnNth.get(el) || 0) : undefined,
          hrefDupe: !!(href && (hrefCount.get(href) || 0) > 1),
        }];
      });

      // ── Buttons ─────────────────────────────────────────────────────────────
      const btnSel = "button, [role='button'], input[type='submit'], input[type='button'], input[type='reset']";
      const buttons = [...document.querySelectorAll(btnSel)]
        .filter(isVisible)
        .slice(0, 50)
        .map(b => ({ text: txt(b).slice(0, 100), ariaLabel: attr(b, 'aria-label'), id: attr(b, 'id') }));

      // ── Links ────────────────────────────────────────────────────────────────
      // Keep hash-router hrefs (#/path) but drop plain anchors (#section) and
      // non-navigable protocols.
      const links = [...document.querySelectorAll('a[href]')]
        .slice(0, maxLinks)
        .map(a => ({ text: txt(a).slice(0, 80), href: attr(a, 'href'), ariaLabel: attr(a, 'aria-label') }))
        .filter(l => {
          if (l.href.startsWith('javascript:') || l.href.startsWith('mailto:') || l.href.startsWith('tel:')) return false;
          if (l.href.startsWith('#') && !l.href.startsWith('#/')) return false; // plain anchor
          return true;
        });

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

export async function collectAccessibilityTree(page: Page): Promise<unknown> {
  // First attempt — quick. If the page is still settling this can return null.
  try {
    const first = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => null);
    if (first) return first;
  } catch { /* fall through to retry */ }
  // Retry once with a longer timeout — covers slow SPAs that hadn't finished
  // rendering on the first attempt.
  try {
    return await page.locator('body').ariaSnapshot({ timeout: 8000 }).catch(() => null) ?? null;
  } catch {
    return null;
  }
}

// ── Sitemap discovery ─────────────────────────────────────────────────────────

/**
 * Fetch same-origin URLs from /sitemap.xml (with /robots.txt Sitemap: hint).
 * Also handles sitemap index files that reference child sitemaps.
 * Returns up to `maxUrls` absolute URLs, all from the same origin.
 */
export async function fetchSitemapUrls(
  origin: string,
  maxUrls = 300,
  log?: (msg: string) => void,
): Promise<string[]> {
  const collected = new Set<string>();

  // Step 1: Check robots.txt for a Sitemap: directive
  let sitemapUrl = `${origin}/sitemap.xml`;
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': 'Mozilla/5.0 TestPilot-Crawler' },
    });
    if (robotsRes.ok) {
      const text = await robotsRes.text();
      const match = text.match(/^Sitemap:\s*(.+)$/im);
      if (match) {
        sitemapUrl = match[1].trim();
        log?.(`  [sitemap] robots.txt points to: ${sitemapUrl}`);
      }
    }
  } catch { /* robots.txt is optional */ }

  // Step 2: Fetch and parse the sitemap (handles both index and regular)
  async function parseSitemap(url: string, depth = 0): Promise<void> {
    if (depth > 2 || collected.size >= maxUrls) return;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8_000),
        headers: { 'User-Agent': 'Mozilla/5.0 TestPilot-Crawler' },
      });
      if (!res.ok) return;
      const xml = await res.text();

      // Sitemap index: <sitemapindex> contains <sitemap><loc>child.xml</loc></sitemap>
      const isSitemapIndex = xml.includes('<sitemapindex');
      const locMatches = [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)];

      for (const m of locMatches) {
        if (collected.size >= maxUrls) break;
        const raw = m[1].trim().replace(/&amp;/g, '&').replace(/\s+/g, '');
        try {
          const parsed = new URL(raw);
          if (isSitemapIndex && depth < 2) {
            // Recurse into child sitemaps
            await parseSitemap(parsed.href, depth + 1);
          } else if (parsed.origin === origin) {
            const clean = parsed.href.split('#')[0];
            collected.add(clean);
          }
        } catch { /* invalid URL — skip */ }
      }
    } catch { /* sitemap not available */ }
  }

  await parseSitemap(sitemapUrl);

  const results = [...collected];
  if (results.length > 0) {
    log?.(`  [sitemap] seeding queue with ${results.length} URL(s)`);
  } else {
    log?.(`  [sitemap] none found at ${sitemapUrl}`);
  }
  return results;
}

// ── pushState interception ────────────────────────────────────────────────────

/**
 * Script injected via page.addInitScript() BEFORE any page JavaScript runs.
 * Wraps history.pushState, history.replaceState, and the hashchange event
 * to record every URL the SPA navigates to during initialisation.
 *
 * Results are collected afterwards with collectPushedUrls().
 */
export const PUSHSTATE_INTERCEPT_SCRIPT = `
(function () {
  if (window.__tpRoutes) return;
  window.__tpRoutes = [];
  function record(url) {
    if (!url) return;
    try {
      var abs = new URL(String(url), location.href).href;
      if (window.__tpRoutes.indexOf(abs) === -1) window.__tpRoutes.push(abs);
    } catch (e) {}
  }
  var origPush    = history.pushState.bind(history);
  var origReplace = history.replaceState.bind(history);
  history.pushState = function (state, title, url) {
    record(url); return origPush(state, title, url);
  };
  history.replaceState = function (state, title, url) {
    record(url); return origReplace(state, title, url);
  };
  window.addEventListener('hashchange', function () { record(location.href); });
})();
`;

/**
 * Collect all URLs that were pushed/replaced since the intercept script ran.
 * Call this after page load + networkidle to capture framework-driven routing.
 */
export async function collectPushedUrls(page: Page): Promise<string[]> {
  try {
    const result = await page.evaluate(() => (window as unknown as { __tpRoutes?: string[] }).__tpRoutes ?? []);
    return result as string[];
  } catch {
    return [];
  }
}
