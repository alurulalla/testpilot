/**
 * Scenario-based test generator.
 *
 * Given a natural-language description ("user checks network routing page on Playwright docs"),
 * either finds an existing test that covers it or generates a focused new one.
 *
 * Key improvements over naive generation:
 *  - Semantically scores every site-map page against the description to find the
 *    most relevant page(s) and passes their full element/heading/link data to the LLM.
 *  - Gives the LLM the EXACT URL to navigate to — no guessing.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { ChatModel, ChatMessage } from './types';
import type { Workspace } from './workspace';
import type { AvailableTest } from '@/types/session';

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTypeScript(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/** Return all test names found in a spec file. */
function extractTestNames(content: string): string[] {
  const names: string[] = [];
  const re = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  return names;
}

// Words that appear in virtually every Playwright test file and page title —
// useless for distinguishing one scenario from another, so we strip them
// before scoring to avoid false-positive matches.
const SCORE_STOP_WORDS = new Set([
  // Generic English filler
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'via',
  'through', 'using', 'able', 'want', 'need', 'needs', 'then',
  // Universal test / UI action words (in every spec file)
  'user', 'test', 'tests', 'page', 'site',
  'navigate', 'navigates', 'navigation',
  'check', 'checks', 'verify', 'verifies', 'verifying',
  'open', 'opens', 'click', 'clicks', 'clicking',
  'view', 'views', 'see', 'sees', 'show', 'shows',
  'visit', 'visits', 'load', 'loads', 'go', 'goes',
  'can', 'will', 'should', 'get', 'gets', 'use', 'used',
]);

/** Score how well a text block matches a description (0–1, keyword overlap).
 *  Common stop-words and universal test-file words are excluded so that
 *  meaningful content words (e.g. "debugging", "network-routing", "login")
 *  drive the score rather than noise. */
function scoreText(text: string, description: string): number {
  const words = description.toLowerCase().split(/\W+/)
    .filter(w => w.length > 2 && !SCORE_STOP_WORDS.has(w));
  if (words.length === 0) return 0;
  const lower = text.toLowerCase();
  return words.filter(w => lower.includes(w)).length / words.length;
}

// ── Page relevance scoring ─────────────────────────────────────────────────────

export interface SiteMapPage {
  url: string;
  title: string;
  elements: Record<string, unknown>;
}

/**
 * Score every page in the site map against the scenario description and return
 * the top N most relevant pages with their full element data.
 */
export function findRelevantPages(
  description: string,
  pages: SiteMapPage[],
  topN = 3,
): (SiteMapPage & { score: number })[] {
  const scored = pages.map(p => {
    // Score against URL path + title + headings
    const headings = (p.elements?.headings as string[] | undefined)?.join(' ') ?? '';
    const links = (p.elements?.links as { text: string }[] | undefined)
      ?.map(l => l.text).join(' ') ?? '';
    const combined = `${p.url} ${p.title} ${headings} ${links}`;
    return { ...p, score: scoreText(combined, description) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .filter(p => p.score > 0);
}

/** Format a page's details into a compact block for the LLM prompt. */
function formatPageForPrompt(p: SiteMapPage, index: number): string {
  const headings = (p.elements?.headings as string[] | undefined) ?? [];
  const links = (p.elements?.links as { text: string; href: string }[] | undefined) ?? [];
  const buttons = (p.elements?.buttons as string[] | undefined) ?? [];

  const lines: string[] = [
    `--- Page ${index + 1} ---`,
    `URL:      ${p.url}`,
    `Title:    ${p.title}`,
  ];
  if (headings.length) lines.push(`Headings: ${headings.slice(0, 5).join(' · ')}`);
  if (buttons.length)  lines.push(`Buttons:  ${buttons.slice(0, 6).join(', ')}`);
  if (links.length)    lines.push(`Links:    ${links.slice(0, 8).map(l => `"${l.text}" → ${l.href}`).join('; ')}`);

  return lines.join('\n');
}

// ── Find existing test ────────────────────────────────────────────────────────

export interface FindResult {
  found: true;
  testFile: string;
  testContent: string;
  matchedTests: string[];
  /** All spec files discovered in the workspace */
  allTests: AvailableTest[];
}

export interface NotFoundResult {
  found: false;
  /** All spec files discovered in the workspace */
  allTests: AvailableTest[];
}

export type FindOrMiss = FindResult | NotFoundResult;

/**
 * Ask the LLM whether any existing spec file already covers the scenario.
 *
 * We send only a compact catalog (filename + test names, no full file content)
 * so the prompt stays small. The model returns JSON: `{ "index": N }` where N
 * is the 0-based position in the catalog, or -1 if nothing matches.
 *
 * Falls back to "not found" on any error so generation always proceeds safely.
 */
export async function findExistingTest(
  description: string,
  workspace: Workspace,
  model: ChatModel,
): Promise<FindOrMiss> {
  const emptyAllTests: AvailableTest[] = [];

  if (!existsSync(workspace.testsDir)) return { found: false, allTests: emptyAllTests };

  const specs = workspace.testFiles();
  if (specs.length === 0) return { found: false, allTests: emptyAllTests };

  // Build a compact catalog: filename + list of test names inside
  const catalog: Array<{ path: string; content: string; names: string[] }> = [];
  for (const specPath of specs) {
    try {
      const content = readFileSync(specPath, 'utf8');
      const names = extractTestNames(content);
      if (names.length > 0) catalog.push({ path: specPath, content, names });
    } catch { /* skip unreadable files */ }
  }

  // Always build the full available-tests list for the UI
  const allTests: AvailableTest[] = catalog.map(f => ({
    testFile: f.path,
    fileName: path.basename(f.path),
    testNames: f.names,
  }));

  if (catalog.length === 0) return { found: false, allTests };

  // Compact listing sent to the LLM — filenames + test titles only
  const listing = catalog
    .map((f, i) =>
      `[${i}] ${path.basename(f.path)}\n` +
      f.names.map(n => `  • ${n}`).join('\n'),
    )
    .join('\n\n');

  try {
    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a test-coverage matcher. Given a scenario description and a list of ' +
          'existing Playwright spec files (with their individual test names), decide whether ' +
          'any file already covers the described scenario — same feature, same page, same intent.\n' +
          'Reply with JSON only — no prose, no markdown fences:\n' +
          '  {"index": <0-based index of the matching file, or -1 if none match>, ' +
          '"reason": "<one short sentence>"}',
      },
      {
        role: 'user',
        content:
          `Scenario: "${description}"\n\n` +
          `Existing spec files:\n${listing}\n\n` +
          `Does any of these already cover exactly this scenario? Reply with JSON only.`,
      },
    ]);

    // Extract the first JSON object from the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { index?: number; reason?: string };
      const idx = typeof parsed.index === 'number' ? parsed.index : -1;
      if (idx >= 0 && catalog[idx]) {
        const hit = catalog[idx];
        return {
          found: true,
          testFile: hit.path,
          testContent: hit.content,
          matchedTests: hit.names,
          allTests,
        };
      }
    }
  } catch {
    // LLM call failed — fall through to "not found" so generation proceeds
  }

  return { found: false, allTests };
}

// ── Generate scenario test ────────────────────────────────────────────────────

export interface GenerateScenarioOptions {
  description: string;
  workspace: Workspace;
  model: ChatModel;
  siteMapPages?: SiteMapPage[];
  /** Compact app-profile context block (Phase 2). */
  appContext?: string;
}

export interface GenerateScenarioResult {
  testFile: string;
  testContent: string;
  matchedTests: string[];
}

export async function generateScenarioTest(
  options: GenerateScenarioOptions,
): Promise<GenerateScenarioResult> {
  const { description, workspace, model, siteMapPages = [], appContext = '' } = options;

  // Read optional CONTEXT.md for credential hints
  let contextHint = '';
  const contextPath = path.join(workspace.dir, 'CONTEXT.md');
  if (existsSync(contextPath)) {
    contextHint = '\n\n' + readFileSync(contextPath, 'utf8').trim();
  }

  // ── Find the most relevant page(s) for this scenario ──────────────────────
  const relevantPages = findRelevantPages(description, siteMapPages, 3);

  // Build a list of ALL discovered URLs (so the LLM can pick others if needed)
  const allUrls = siteMapPages
    .map(p => `  ${p.url}  "${p.title}"`)
    .join('\n');

  // Detailed context for the top matching pages
  const relevantContext = relevantPages.length > 0
    ? `\nMost relevant pages for this scenario:\n${relevantPages.map((p, i) => formatPageForPrompt(p, i)).join('\n\n')}`
    : '';

  // The best-matching URL is the primary target — tell the LLM to go directly there
  const targetUrl = relevantPages[0]?.url ?? workspace.url;

  const systemPrompt =
    'You are an expert Playwright Test engineer (TypeScript). ' +
    'You will be given a scenario description, the exact URL of the most relevant page, ' +
    'and details about that page\'s headings, buttons, and links. ' +
    'Write a single focused test file that navigates directly to that page and verifies the scenario. ' +
    'Use accessibility-first locators (getByRole, getByLabel, getByText). ' +
    'Return ONLY the complete TypeScript file — no markdown fences, no explanation.' +
    (appContext ? `\n\n${appContext}` : '') +
    contextHint;

  const userPrompt =
    `Scenario: ${description}\n\n` +
    `Primary target URL (navigate here directly): ${targetUrl}\n` +
    `Base URL: ${workspace.url}\n` +
    relevantContext +
    (allUrls ? `\n\nAll discovered pages:\n${allUrls}` : '') +
    `\n\nRules:\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Navigate directly to "${targetUrl}" — do NOT start from the homepage and click through\n` +
    `- Use getByRole, getByLabel, getByText, getByPlaceholder — NEVER CSS class selectors\n` +
    `- Each test step must reflect the described scenario\n` +
    `- Check that the page title or a key heading is visible to confirm you landed on the right page\n` +
    `- If credentials exist in environment variables, use them\n` +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  const raw     = await model.invoke(messages);
  const cleaned = extractTypeScript(raw);

  // Ensure fixtures.ts exists
  const fixturesPath = path.join(workspace.testsDir, 'fixtures.ts');
  if (!existsSync(fixturesPath)) {
    mkdirSync(workspace.testsDir, { recursive: true });
    writeFileSync(
      fixturesPath,
      `import { test as base } from '@playwright/test';\n\n` +
      `export const TARGET_URL = ${JSON.stringify(workspace.url)};\n\n` +
      `export const test = base.extend<{ targetUrl: string }>({ targetUrl: async ({}, use) => use(TARGET_URL) });\n\n` +
      `export { expect } from '@playwright/test';\n`,
      'utf8',
    );
  }

  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const testFile = path.join(workspace.testsDir, `scenario-${slug}.spec.ts`);
  writeFileSync(testFile, cleaned, 'utf8');

  return { testFile, testContent: cleaned, matchedTests: extractTestNames(cleaned) };
}
