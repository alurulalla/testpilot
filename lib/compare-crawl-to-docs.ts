/**
 * compare-crawl-to-docs.ts
 *
 * Compares what was actually found during site crawl against the features
 * described in product documentation.
 *
 * For each documented feature, we check whether any crawled page or element
 * contains matching keywords.  This surfaces two useful signals:
 *
 *   - "covered"  → feature found in crawl → safe to generate tests
 *   - "missing"  → feature mentioned in docs but NOT seen in crawl
 *                   → either needs authentication to reach, or is truly absent
 */

import type { SiteMap } from '@/types/session';

export interface CrawlVsDocsResult {
  /** Feature sections found (matched in crawled content) */
  covered: string[];
  /** Feature sections from docs not matched in any crawled page/element */
  missing: string[];
  /** Total features evaluated */
  total: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extract all feature section headings from product documentation markdown. */
function extractFeatureNames(contextMd: string): string[] {
  const names: string[] = [];

  // Skip doc-metadata headings — they have no page elements and shouldn't be counted
  // as testable features.
  // NOTE: use SKIP (continue) not STOP (break) — in many docs like demo.md the credentials
  // section appears BEFORE the application page sections (e.g. §2 "Test Credentials" before
  // §4 "Application Pages"), so breaking on the first metadata heading would cause every
  // page feature to be missed.
  const SKIP = /^(Typical\s+User\s+Journey|Best Practices?|Summary|User Flows? to Test|Test Credentials?|Key Testing Scenarios?|Automation|Known Limitations?|References?|Useful\s+.+Selectors?|Visual Regression|Performance|Broken Functionality|Negative|Happy Path|Overview|Homepage Sections?|Sections?|Features?|Table of Contents|Introduction|Application Pages?|Navigation|Global Elements?|User Personas?)/i;

  for (const raw of contextMd.split('\n')) {
    const line = raw.trim();
    // Match any ## / ### / #### heading, strip optional leading "3.1 " number prefix
    const hm = line.match(/^#{2,4}\s+(?:\d+[\d.]*[.)]\s+)?(.+)/);
    if (!hm) continue;
    const name = hm[1].trim()
      .replace(/`([^`]+)`/g, '$1') // strip backtick escapes: `standard_user` → standard_user
      .trim();

    if (name.match(SKIP)) continue; // skip metadata and broad parent sections

    names.push(name);
  }
  return names;
}

/** Build a single searchable text blob from all crawled pages. */
function buildCrawlText(siteMap: SiteMap): string {
  const parts: string[] = [];
  const pages = (siteMap as unknown as {
    pages?: { url: string; title: string; elements: Record<string, unknown> }[]
  }).pages ?? [];

  for (const page of pages) {
    parts.push(page.url.toLowerCase());
    parts.push(page.title.toLowerCase());

    const el = page.elements as Record<string, unknown[]>;
    for (const [, values] of Object.entries(el)) {
      for (const v of values) {
        if (typeof v === 'string') parts.push(v.toLowerCase());
        else if (v && typeof v === 'object' && 'text' in v) {
          parts.push(String((v as { text: string }).text).toLowerCase());
        }
      }
    }
  }
  return parts.join(' ');
}

/**
 * Convert a feature name like "Header Navigation" into search keywords.
 * Splits on spaces and strips very common words, keeping significant terms.
 */
function featureToKeywords(name: string): string[] {
  const STOP_WORDS = new Set([
    'and', 'or', 'the', 'a', 'an', 'is', 'are', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'as', 'its', 'it', 'be', 'was',
  ]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Compare features documented in contextMd against the crawled siteMap.
 * Returns which features were confirmed present and which appear missing.
 *
 * Note: "missing" means no keyword match was found in the crawl — it may
 * be that the feature lives behind authentication or on a page not yet
 * crawled.  Treat it as a signal to investigate, not a hard verdict.
 */
export function compareCrawlToDocs(
  siteMap: SiteMap,
  contextMd: string,
): CrawlVsDocsResult {
  const featureNames = extractFeatureNames(contextMd);
  if (featureNames.length === 0) {
    return { covered: [], missing: [], total: 0 };
  }

  const crawlText = buildCrawlText(siteMap);
  const covered: string[] = [];
  const missing: string[] = [];

  for (const name of featureNames) {
    const keywords = featureToKeywords(name);
    if (keywords.length === 0) {
      covered.push(name); // can't evaluate — assume covered
      continue;
    }

    // Feature is "found" if at least half its significant keywords appear in the crawl
    const matchCount = keywords.filter(kw => crawlText.includes(kw)).length;
    const threshold = Math.ceil(keywords.length / 2);

    if (matchCount >= threshold) {
      covered.push(name);
    } else {
      missing.push(name);
    }
  }

  return { covered, missing, total: featureNames.length };
}
