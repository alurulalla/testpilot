/**
 * Feature synthesis — turns a raw crawl (SiteMap) into a structured list of
 * user-facing FEATURES and end-to-end USER FLOWS.
 *
 * Why: the crawler finds *pages*; this step answers "what can a user actually
 * DO on this site?" — which is what test generation should cover. It runs on
 * every session (not just when a product doc is uploaded), and merges with any
 * doc-derived feature names when those exist.
 *
 * Grounding rule: features may only reference elements/pages that were actually
 * crawled. Flows are allowed to sequence real elements across pages, but never
 * to invent steps or selectors that weren't observed.
 *
 * Cost: ONE model call over a compact whole-site summary (headings, forms, and
 * deduped interactive names per page — no raw HTML or accessibility dumps).
 */
import type { ChatModel } from '@/lib/pilot';

// ── Types ───────────────────────────────────────────────────────────────────

interface CrawlPage {
  url: string;
  title?: string;
  elements?: Record<string, unknown>;
}
interface CrawlSiteMap {
  start_url?: string;
  pages: CrawlPage[];
}

export interface DiscoveredFeature {
  id: string;
  name: string;
  description: string;
  /** 'feature' = single-page capability; 'flow' = multi-page journey. */
  type: 'feature' | 'flow';
  /** URLs of crawled pages this feature touches. */
  pageUrls: string[];
  /** Ordered steps for a flow (plain English, grounded in real elements). */
  steps?: string[];
}

interface Interactive { role: string; name: string; href?: string }

// ── Compact site summary ──────────────────────────────────────────────────────

/** Build a token-efficient summary of the crawl for the synthesis prompt. */
function buildSiteSummary(siteMap: CrawlSiteMap, maxPages = 40): string {
  const pages = siteMap.pages.slice(0, maxPages);
  const blocks = pages.map(p => {
    const el = p.elements ?? {};
    const headings = ((el.headings as string[] | undefined) ?? []).slice(0, 8);
    const forms = ((el.forms as { id?: string; action?: string }[] | undefined) ?? [])
      .map(f => f.id || f.action || 'form').slice(0, 5);
    const ints = ((el.interactives as Interactive[] | undefined) ?? []);
    // Dedupe interactive names, keep role for context, cap to keep it compact.
    const seen = new Set<string>();
    const interactiveLines: string[] = [];
    for (const i of ints) {
      const key = `${i.role}:${i.name}`.toLowerCase();
      if (seen.has(key) || !i.name) continue;
      seen.add(key);
      interactiveLines.push(`${i.role} "${i.name}"`);
      if (interactiveLines.length >= 25) break;
    }
    const lines = [`PAGE: ${p.url}${p.title ? `  — ${p.title}` : ''}`];
    if (headings.length) lines.push(`  headings: ${headings.join(' | ')}`);
    if (forms.length)    lines.push(`  forms: ${forms.join(', ')}`);
    if (interactiveLines.length) lines.push(`  actions: ${interactiveLines.join(', ')}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a senior QA analyst. You are given a compact map of a web application: ' +
  'its pages, headings, forms, and the interactive elements (links/buttons/inputs) found on each page. ' +
  'Identify the distinct user-facing FEATURES and end-to-end USER FLOWS the application supports.\n\n' +
  'RULES:\n' +
  '• Only describe things supported by the crawl data — never invent features, pages, or controls.\n' +
  '• A "feature" is a single capability on one page (e.g. "Search products", "Contact form").\n' +
  '• A "flow" is a journey across pages built from REAL elements (e.g. "Add to cart → view cart → checkout").\n' +
  '• Prefer concrete, testable capabilities over vague descriptions.\n' +
  '• Use the exact page URLs from the data in pageUrls.\n\n' +
  'Return ONLY a JSON array — no prose, no markdown fences. Schema:\n' +
  '[{ "name": string, "description": string, "type": "feature"|"flow", "pageUrls": string[], "steps"?: string[] }]\n' +
  'Limit to the 20 most important items.';

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'feature';
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

export interface SynthesizeFeaturesOptions {
  siteMap: CrawlSiteMap;
  model: ChatModel;
  /** Feature names already known from an uploaded product doc — merged + deduped. */
  docFeatureNames?: string[];
  onProgress?: (msg: string) => void;
}

export async function synthesizeFeatures(
  options: SynthesizeFeaturesOptions,
): Promise<DiscoveredFeature[]> {
  const { siteMap, model, docFeatureNames = [], onProgress } = options;
  const log = (m: string) => onProgress?.(m);

  if (!siteMap.pages?.length) return [];

  const summary = buildSiteSummary(siteMap);
  const docHint = docFeatureNames.length
    ? `\n\nThe product documentation also lists these features — incorporate any that the crawl supports, ` +
      `and add others you discover:\n${docFeatureNames.slice(0, 40).map(f => `• ${f}`).join('\n')}`
    : '';

  let raw: string;
  try {
    raw = await model.invoke(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `SITE MAP (${siteMap.pages.length} pages crawled):\n\n${summary}${docHint}` },
      ],
      { maxTokens: 3_000 },
    );
  } catch (err) {
    log(`  feature synthesis failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: Array<Partial<DiscoveredFeature>>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  // Validate + dedupe by normalized name.
  const byName = new Map<string, DiscoveredFeature>();
  for (const f of parsed) {
    if (!f.name || !f.description) continue;
    const key = normalizeName(f.name);
    if (byName.has(key)) continue;
    byName.set(key, {
      id: slugifyName(f.name),
      name: f.name,
      description: f.description,
      type: f.type === 'flow' ? 'flow' : 'feature',
      pageUrls: Array.isArray(f.pageUrls) ? f.pageUrls.slice(0, 10) : [],
      ...(Array.isArray(f.steps) && f.steps.length ? { steps: f.steps.slice(0, 12) } : {}),
    });
  }

  const features = Array.from(byName.values()).slice(0, 20);
  log(`  synthesized ${features.length} feature(s)/flow(s)`);
  return features;
}

// ── Rendering for generation prompts ──────────────────────────────────────────

/** Render the discovered features as a compact checklist for the generation prompt. */
export function renderFeatureChecklist(features: DiscoveredFeature[]): string {
  if (!features.length) return '';
  const lines = features.map(f => {
    const head = `- [${f.type}] ${f.name}: ${f.description}`;
    const steps = f.steps?.length ? `\n    steps: ${f.steps.join(' → ')}` : '';
    return head + steps;
  });
  return (
    `\n\n## Discovered features to cover\n` +
    `The crawl identified these user-facing capabilities. Ensure the generated tests ` +
    `cover the ones relevant to this page (use only real, crawled selectors):\n` +
    lines.join('\n')
  );
}
