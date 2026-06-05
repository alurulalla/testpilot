/**
 * Phase 1.75 — LLM Selector Discovery
 *
 * After the site has been crawled (Phases 1 + 1.6) and before test generation
 * (Phase 2), this module asks an LLM to map every documented feature action to
 * the most precise Playwright selector that exists in the real DOM.
 *
 * Separating "selector resolution" from "test writing" means the generator
 * never has to guess — it receives a pre-verified selector map and can focus
 * entirely on test logic.
 *
 * Output: an array of PageSelectorMap objects that is written to
 * selector-hints.json in the workspace directory.
 */

import type { ChatModel, ChatMessage } from './types';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SelectorHint {
  /** Short description of the action this selector enables.
   *  e.g. "Click Checkout button", "Fill First Name field" */
  action: string;
  /** Ready-to-use Playwright expression.
   *  e.g. "page.locator('[data-test=\"checkout\"]')" */
  selector: string;
  /** How confident the LLM was in this mapping. */
  confidence: 'high' | 'medium' | 'low';
}

export interface PageSelectorMap {
  pageUrl:     string;
  featureName: string;
  hints:       SelectorHint[];
}

export interface DiscoverSelectorsOptions {
  siteMap: {
    pages: {
      url:               string;
      title:             string;
      elements:          Record<string, unknown>;
      accessibility_tree?: unknown;
    }[];
  };
  contextMd:   string;
  model:       ChatModel;
  onProgress?: (msg: string) => void;
}

// ── LLM system prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a Playwright selector expert.\n' +
  'Given the DOM elements of a web page and a feature description from product docs, ' +
  'output the most precise Playwright selector for each testable action.\n\n' +
  'SELECTOR PRIORITY (highest → lowest):\n' +
  '  1. [data-test="..."] attribute  →  page.locator(\'[data-test="x"]\')\n' +
  '  2. #id attribute                →  page.locator(\'#id\')\n' +
  '  3. role + accessible name       →  page.getByRole(\'button\', { name: \'X\' })\n' +
  '  4. CSS class                    →  page.locator(\'.class-name\')\n\n' +
  'HARD RULES:\n' +
  '  - SPA navigation buttons: use getByRole(\'button\') NOT locator(\'a[href="/page.html"]\')\n' +
  '  - Password inputs: locator(\'input[type="password"]\'), NEVER getByRole(\'textbox\')\n' +
  '  - Inputs without aria-label: use id or data-test, NOT getByLabel()\n' +
  '  - ONLY use selectors grounded in the DOM data supplied — NEVER invent\n' +
  '  - If an element is not in the DOM data, omit it — do NOT guess\n\n' +
  'Return ONLY a valid JSON array — no markdown, no explanation.\n' +
  'Format:\n' +
  '[\n' +
  '  {"action": "brief description", "selector": "page.locator(\'[data-test=\\"x\\"]\') ", "confidence": "high"},\n' +
  '  {"action": "...", "selector": "page.getByRole(\'button\', { name: \'X\' })", "confidence": "high"}\n' +
  ']';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a page's DOM elements into a compact text block for the LLM. */
function formatElements(elements: Record<string, unknown>): string {
  const lines: string[] = [];

  type Interactive = { role: string; name: string; id: string; testId: string };
  const interactives = (elements.interactives as Interactive[] | undefined) ?? [];
  if (interactives.length > 0) {
    lines.push('BUTTONS & LINKS:');
    for (const el of interactives.slice(0, 60)) {
      let line = `  ${el.role.padEnd(10)} "${el.name}"`;
      if (el.testId) line += `  [data-test="${el.testId}"]`;
      if (el.id)     line += `  #${el.id}`;
      lines.push(line);
    }
  }

  type InputEl = {
    type: string; id: string; name: string;
    placeholder: string; ariaLabel: string; testId: string;
  };
  const inputs = (elements.inputs as InputEl[] | undefined) ?? [];
  if (inputs.length > 0) {
    lines.push('\nINPUTS:');
    for (const inp of inputs.slice(0, 25)) {
      let line = `  input[type="${inp.type}"]`;
      if (inp.id)          line += `  #${inp.id}`;
      if (inp.testId)      line += `  [data-test="${inp.testId}"]`;
      if (inp.ariaLabel)   line += `  aria-label="${inp.ariaLabel}"`;
      if (inp.placeholder) line += `  placeholder="${inp.placeholder}"`;
      lines.push(line);
    }
  }

  return lines.join('\n') || '  (no elements captured)';
}

/** Extract the URL path hint from a feature heading like "Cart Page (/cart.html)". */
function extractPathHint(heading: string): string | null {
  const m = heading.match(/\((\/[^)]+)\)/);
  return m ? m[1].toLowerCase() : null;
}

/** Parse contextMd into an array of section objects. */
function parseDocSections(
  contextMd: string,
): { heading: string; items: string[] }[] {
  const sections: { heading: string; items: string[] }[] = [];

  // Skip sections that are pure metadata — they have no page elements to discover selectors for.
  // NOTE: we use SKIP (continue), never STOP (break).  In many docs the credentials / overview
  // sections appear BEFORE the feature sections (e.g. demo.md §2 "Test Credentials" precedes
  // §4 "Application Pages") so breaking early would miss every page feature entirely.
  const SKIP = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction|Application Pages?|Navigation|Global Elements?|User Personas?|Test Credentials?|Typical\s+User\s+Journey|Best Practices?|User Flows?|Key Testing|Automation|Known Limitations?|References?|Useful\s+.+Selectors?|Visual Regression|Performance|Broken Functionality|Negative|Happy Path)/i;

  const parts = contextMd.split(/\n(?=#{2,4}\s)/);
  for (const part of parts) {
    const hm = part.match(/^#{2,4}\s+(?:\d+[\d.]*[.)]\s+)?(.+)/m);
    if (!hm) continue;
    const heading = hm[1].trim().replace(/`([^`]+)`/g, '$1').trim();
    if (heading.match(SKIP)) continue; // skip metadata, never break

    const items = (part.match(/^[-*]\s+.+/gm) ?? [])
      .map(l => l.replace(/^[-*]\s+/, '').trim());

    sections.push({ heading, items });
  }
  return sections;
}

/**
 * Find the doc sections that match a given page URL.
 * Primary: URL path hint in the heading (e.g. `(/cart.html)`).
 * Fallback: keyword overlap between the URL slug and the heading.
 */
function findMatchingSections(
  pageUrl: string,
  sections: { heading: string; items: string[] }[],
): { heading: string; items: string[] }[] {
  try {
    const pagePath = new URL(pageUrl).pathname.toLowerCase();
    const primary: { heading: string; items: string[] }[] = [];

    for (const sec of sections) {
      const hint = extractPathHint(sec.heading);
      if (hint) {
        // Exact match or the page path contains the hint path (minus .html)
        const bare = hint.replace(/\.html?$/, '');
        if (pagePath === hint || pagePath.includes(bare)) {
          primary.push(sec);
        }
      }
    }
    if (primary.length > 0) return primary;

    // Keyword fallback — split URL slug and match against heading words
    const slug = pagePath
      .split('/')
      .join(' ')
      .replace(/[_.\-]/g, ' ')
      .replace(/\.html?$/, '');

    const slugTokens = slug.split(/\s+/).filter(t => t.length > 3);
    return sections.filter(sec =>
      slugTokens.some(t => sec.heading.toLowerCase().includes(t)),
    );
  } catch {
    return [];
  }
}

/** Parse the LLM JSON response into SelectorHint[]. Robust to fences and extra prose. */
function parseHints(raw: string): SelectorHint[] {
  const jsonMatch = raw.trim().match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { action: string; selector: string; confidence?: string } =>
          item && typeof item.action === 'string' && typeof item.selector === 'string',
      )
      .map(item => ({
        action:     item.action,
        selector:   item.selector,
        confidence: (['high', 'medium', 'low'].includes(item.confidence ?? '')
          ? (item.confidence as 'high' | 'medium' | 'low')
          : 'medium'),
      }));
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run selector discovery for every crawled page that has a matching doc section.
 * Returns a PageSelectorMap per (page, feature) pair.
 * Non-fatal — errors per page are logged and skipped.
 */
export async function discoverSelectors(
  options: DiscoverSelectorsOptions,
): Promise<PageSelectorMap[]> {
  const { siteMap, contextMd, model, onProgress } = options;
  const log = (msg: string) => onProgress?.(msg);

  const docSections = parseDocSections(contextMd);
  if (docSections.length === 0) {
    log('  [selector-discovery] No doc sections found — skipping');
    return [];
  }

  const pages = siteMap.pages ?? [];
  log(
    `  [selector-discovery] ${pages.length} page(s) × ${docSections.length} doc section(s)`,
  );

  const results: PageSelectorMap[] = [];
  // Cap per-run cost: max 12 pages (each makes 1 focused LLM call per matched feature)
  const MAX_PAGES = 12;

  for (const page of pages.slice(0, MAX_PAGES)) {
    const matched = findMatchingSections(page.url, docSections);
    if (matched.length === 0) {
      log(`  [selector-discovery] No doc match for ${page.url} — skipping`);
      continue;
    }

    for (const section of matched) {
      log(`  [selector-discovery] "${section.heading}" ← ${page.url}`);

      const domSummary = formatElements(page.elements);

      // Include a truncated accessibility tree for extra context
      const a11ySnippet = page.accessibility_tree
        ? `\nACCESSIBILITY TREE (partial):\n${
            (typeof page.accessibility_tree === 'string'
              ? page.accessibility_tree
              : JSON.stringify(page.accessibility_tree, null, 2)
            ).slice(0, 2_500)
          }`
        : '';

      const featureText =
        `## ${section.heading}\n` +
        (section.items.length > 0
          ? section.items.map(i => `- ${i}`).join('\n')
          : '(see feature name)');

      const userMessage =
        `Page URL: ${page.url}\n` +
        `Page title: ${page.title}\n\n` +
        `DOM ELEMENTS:\n${domSummary}${a11ySnippet}\n\n` +
        `FEATURE FROM PRODUCT DOCS:\n${featureText}`;

      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ];

      try {
        const raw   = await model.invoke(messages, { maxTokens: 1_500 });
        const hints = parseHints(raw);
        if (hints.length > 0) {
          results.push({ pageUrl: page.url, featureName: section.heading, hints });
          log(
            `  [selector-discovery] "${section.heading}": ${hints.length} selector(s) — ` +
            hints.map(h => `"${h.action}"`).join(', '),
          );
        } else {
          log(`  [selector-discovery] "${section.heading}": LLM returned no parseable hints`);
        }
      } catch (err) {
        log(
          `  [selector-discovery] "${section.heading}" error (skipped): ` +
          (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  log(
    `  [selector-discovery] Done — ${results.length} page/feature mapping(s) produced`,
  );
  return results;
}
