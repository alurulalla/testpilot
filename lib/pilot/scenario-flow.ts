/**
 * Intent-driven multi-step scenario flows.
 *
 * "Login, add an item to the cart and purchase it" is a JOURNEY across several
 * pages — the single-page scenario generator can't express it. This module:
 *
 *  1. detectMultiStep()    — cheap heuristic: is this description a journey?
 *  2. extractIntent()      — ONE LLM call: description → ordered plan where every
 *                            step has an action AND an expected outcome (what the
 *                            user expects to happen), grounded in crawled pages.
 *  3. generateFlowTest()   — ONE LLM call: plan + the real elements of every page
 *                            the journey touches → a single click-through spec
 *                            that performs each action and ASSERTS each outcome.
 *  4. refineScenarioTest() — used by the capped refine loop: feeds the real run
 *                            error back to fix locators/waits/navigation ONLY.
 *                            Assertions must never be weakened — enforced both in
 *                            the prompt and mechanically by the caller.
 *
 * Token bounds: intent + generation = 2 calls; refinement only runs when a test
 * fails and is capped by the caller (3 attempts).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { ChatModel, ChatMessage } from './types';
import type { Workspace } from './workspace';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlowStep {
  /** What the user does, e.g. "Add the backpack to the cart". */
  action: string;
  /** What the user expects to happen, e.g. "Cart badge shows 1". */
  expected: string;
  /** Crawled page URL this step happens on (best match), if known. */
  pageUrl?: string;
}

export interface SiteMapPageLite {
  url: string;
  title: string;
  elements: Record<string, unknown>;
}

interface Interactive { role: string; name: string; href?: string }

// ── 1. Multi-step detection (no LLM) ──────────────────────────────────────────

const STEP_CONNECTOR_RE = /\b(then|after that|and then|next|afterwards|finally)\b|→|->/gi;
const ACTION_VERB_RE =
  /\b(log\s?in|sign\s?in|login|add|click|open|go to|navigate|fill|enter|select|choose|search|buy|purchase|checkout|check\s?out|submit|complete|verify|remove|view|place)\b/gi;

/**
 * Heuristic: a description is a multi-step journey when it chains several
 * distinct actions. Kept strict so single-page checks stay on the cheap path.
 */
export function detectMultiStep(description: string): boolean {
  const connectors = description.match(STEP_CONNECTOR_RE)?.length ?? 0;
  const verbs = new Set(
    (description.match(ACTION_VERB_RE) ?? []).map(v => v.toLowerCase().replace(/\s+/g, ' ')),
  );
  return connectors >= 1 ? verbs.size >= 2 : verbs.size >= 3;
}

// ── Grounding helpers ─────────────────────────────────────────────────────────

/** Compact one-page summary used for intent extraction (token-lean). */
function pageBrief(p: SiteMapPageLite): string {
  const ints = ((p.elements?.interactives as Interactive[] | undefined) ?? [])
    .slice(0, 12).map(i => i.name).filter(Boolean);
  return `- ${p.url}  "${p.title}"${ints.length ? `  [${ints.join(', ')}]` : ''}`;
}

/** Full locator table for one page (role + name + href) used for generation. */
function pageElementsTable(p: SiteMapPageLite, maxItems = 40): string {
  const ints = ((p.elements?.interactives as Interactive[] | undefined) ?? []).slice(0, maxItems);
  const inputs = (p.elements?.inputs as Array<{ type?: string; id?: string; aria_label?: string; placeholder?: string }> | undefined) ?? [];
  const lines = ints.map(el => {
    let line = `  ${el.role.padEnd(10)} "${el.name}"`;
    if (el.href && el.href !== '#') line += `  href="${el.href}"`;
    return line;
  });
  const inputLines = inputs.slice(0, 12).map(i =>
    `  input      type=${i.type ?? 'text'}${i.id ? ` id="${i.id}"` : ''}${i.aria_label ? ` aria-label="${i.aria_label}"` : ''}${i.placeholder ? ` placeholder="${i.placeholder}"` : ''}`,
  );
  return `PAGE: ${p.url}  "${p.title}"\n${[...lines, ...inputLines].join('\n') || '  (no elements captured)'}`;
}

/** Does the workspace fixtures.ts provide a login() helper? */
export function hasLoginFixture(workspace: Workspace): boolean {
  try {
    const fixtures = path.join(workspace.testsDir, 'fixtures.ts');
    if (!existsSync(fixtures)) return false;
    return readFileSync(fixtures, 'utf8').includes('export async function login');
  } catch {
    return false;
  }
}

// ── 2. Intent extraction ──────────────────────────────────────────────────────

const INTENT_SYSTEM =
  'You are a senior QA analyst. Turn the user\'s scenario into an ordered test plan. ' +
  'Each step has the ACTION the user performs and the OUTCOME they expect to observe afterwards. ' +
  'Expected outcomes must be concrete and observable (an element appears, a badge count changes, ' +
  'a confirmation message shows, the page navigates somewhere).\n' +
  'Ground every step in the provided crawled pages — pick each step\'s pageUrl from that list ' +
  '(or omit it when unsure). NEVER invent pages or capabilities not supported by the crawl.\n' +
  'Return ONLY a JSON array, no prose:\n' +
  '[{ "action": string, "expected": string, "pageUrl"?: string }]\n' +
  'Keep it to at most 8 steps.';

export async function extractIntent(
  description: string,
  pages: SiteMapPageLite[],
  model: ChatModel,
): Promise<FlowStep[]> {
  const pageList = pages.slice(0, 25).map(pageBrief).join('\n');
  const raw = await model.invoke(
    [
      { role: 'system', content: INTENT_SYSTEM },
      {
        role: 'user',
        content:
          `Scenario: "${description}"\n\nCrawled pages (with visible actions):\n${pageList}\n\n` +
          `Produce the ordered plan as JSON.`,
      },
    ],
    { maxTokens: 1_500 },
  );

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as Array<Partial<FlowStep>>;
    return parsed
      .filter(s => s.action && s.expected)
      .slice(0, 8)
      .map(s => ({ action: s.action!, expected: s.expected!, pageUrl: s.pageUrl }));
  } catch {
    return [];
  }
}

// ── 3. Flow test generation ───────────────────────────────────────────────────

function extractTypeScript(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return trimmed;
}

const FLOW_RULES =
  `LOCATOR RULES (strictly enforced):\n` +
  `- Use ONLY elements present in the PAGE tables above — never invent selectors\n` +
  `- Links with href → page.locator('a[href="…"]'); otherwise getByRole(role, { name })\n` +
  `- PASSWORD INPUT: <input type="password"> is NOT matched by getByRole('textbox') — use locator('input[type="password"]') or an id selector\n` +
  `- STRICT MODE: for text appearing in multiple places (prices, totals) use a specific container locator then toContainText()\n` +
  `- Each step's expected outcome MUST be asserted with expect() immediately after the step's action\n` +
  `- Use await expect(...).toBeVisible() / toHaveText() / toContainText() / toHaveURL() as appropriate\n`;

export interface GenerateFlowOptions {
  description: string;
  steps: FlowStep[];
  pages: SiteMapPageLite[];
  workspace: Workspace;
  model: ChatModel;
}

export async function generateFlowTest(options: GenerateFlowOptions): Promise<string> {
  const { description, steps, pages, workspace, model } = options;

  // Gather the pages the journey touches (deduped), capped to keep tokens sane.
  const touched = new Map<string, SiteMapPageLite>();
  for (const step of steps) {
    if (!step.pageUrl) continue;
    const page = pages.find(p => p.url === step.pageUrl);
    if (page && !touched.has(page.url)) touched.set(page.url, page);
  }
  // Always include the most element-rich pages if the plan matched nothing.
  if (touched.size === 0) {
    for (const p of pages.slice(0, 3)) touched.set(p.url, p);
  }
  const elementTables = Array.from(touched.values()).slice(0, 5)
    .map(p => pageElementsTable(p)).join('\n\n');

  const useLogin = hasLoginFixture(workspace);
  const planLines = steps.map((s, i) =>
    `${i + 1}. ACTION: ${s.action}\n   EXPECT: ${s.expected}${s.pageUrl ? `\n   PAGE: ${s.pageUrl}` : ''}`,
  ).join('\n');

  const system =
    'You are an expert Playwright Test engineer (TypeScript). Write ONE test that performs the ' +
    'complete user journey below, step by step, asserting each step\'s expected outcome before ' +
    'moving to the next. The journey spans multiple pages — click through them like a real user. ' +
    'Return ONLY the complete TypeScript file — no markdown fences, no explanation.';

  const user =
    `JOURNEY: ${description}\n\n` +
    `ORDERED PLAN (every EXPECT must become an expect() assertion):\n${planLines}\n\n` +
    `REAL ELEMENTS ON THE PAGES INVOLVED (the only allowed locator sources):\n${elementTables}\n\n` +
    FLOW_RULES +
    (useLogin
      ? `- The workspace provides a login helper: import { login } from './fixtures.js' and call ` +
        `await login(page) as the first step IF the journey starts from an authenticated state.\n`
      : '') +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Write exactly ONE test() containing the whole journey (it is sequential by nature)\n` +
    `- Name it after the journey, e.g. test('checkout: ${description.slice(0, 60).replace(/'/g, '')}')\n`;

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const raw = await model.invoke(messages, { maxTokens: 4_096 });
  return extractTypeScript(raw);
}

// ── 4. Refinement (capped loop, assertions are sacred) ───────────────────────

const REFINE_SYSTEM =
  'You are an expert Playwright engineer fixing a FAILING test using its real run output.\n' +
  'You may ONLY fix: locators/selectors, waits/timing, and navigation steps.\n' +
  'HARD RULES — violating any of these makes your output invalid:\n' +
  '  • NEVER delete, comment out, or weaken an expect() assertion\n' +
  '  • NEVER replace a specific assertion with a vaguer one\n' +
  '  • NEVER change what the test verifies — only HOW it locates/waits/navigates\n' +
  '  • Keep the same number of expect() calls (or more)\n' +
  'Return ONLY the complete corrected TypeScript file — no markdown fences, no explanation.';

export interface RefineOptions {
  code: string;
  errorOutput: string;
  pages: SiteMapPageLite[];
  model: ChatModel;
}

export async function refineScenarioTest(options: RefineOptions): Promise<string> {
  const { code, errorOutput, pages, model } = options;
  const grounding = pages.slice(0, 3).map(p => pageElementsTable(p, 30)).join('\n\n');

  const raw = await model.invoke(
    [
      { role: 'system', content: REFINE_SYSTEM },
      {
        role: 'user',
        content:
          `FAILING TEST:\n${code}\n\n` +
          `RUN OUTPUT (the real failure):\n${errorOutput.slice(-4_000)}\n\n` +
          `REAL PAGE ELEMENTS (the only allowed locator sources):\n${grounding}\n\n` +
          `Fix the failure. Locators/waits/navigation only — assertions are untouchable.`,
      },
    ],
    { maxTokens: 4_096 },
  );
  return extractTypeScript(raw);
}

/**
 * Mechanical no-cheating guardrail: a refinement is only acceptable when it
 * keeps at least as many expect() assertions and test() blocks as the original.
 * Prompts can be ignored; this cannot.
 */
export function refinementKeepsAssertions(original: string, refined: string): boolean {
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  const expectsKept = count(refined, /\bexpect\s*\(/g) >= count(original, /\bexpect\s*\(/g);
  const testsKept   = count(refined, /\btest\s*\(/g)   >= count(original, /\btest\s*\(/g);
  const looksLikeTest = refined.includes('test(') && refined.length > 100;
  return expectsKept && testsKept && looksLikeTest;
}
