/**
 * Test suite generator — reads site_map.json and writes one Playwright
 * spec file per page using Claude.
 *
 * Improvements over the original npm-based crawler:
 *  - Reads CONTEXT.md from the workspace directory (written by the loop
 *    route when the user has provided URL context / credentials) and
 *    injects it into the system prompt so Claude generates tests that
 *    actually use the stored environment variables.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ChatModel, ChatMessage } from './types';
import type { Workspace } from './workspace';
import { createAnthropicModel } from './anthropic-model';

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract TypeScript code from an LLM response.
 * Handles three cases:
 *  1. Plain code (no fences) — returned as-is.
 *  2. Code wrapped in a single ```typescript / ```ts / ``` block.
 *  3. Code preceded/followed by explanation text — we grab the first
 *     fenced block that looks like TypeScript, or failing that the raw text.
 */
function extractTypeScript(raw: string): string {
  const trimmed = raw.trim();

  // Try to extract the first fenced code block
  const fenceMatch = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // No fences — return the raw text (might already be clean code)
  return trimmed;
}

/** Convert a page URL to a safe file-name stem. */
function urlToFileName(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    const base   = new URL(baseUrl);
    let pathname = parsed.pathname.replace(base.pathname, '');
    if (!pathname || pathname === '/') return 'homepage';
    pathname = pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathname.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'page';
  } catch {
    return 'page';
  }
}

/** Read CONTEXT.md from the workspace if it exists — contains credentials hint. */
function readContextMd(workspaceDir: string): string | null {
  const contextPath = path.join(workspaceDir, 'CONTEXT.md');
  if (!existsSync(contextPath)) return null;
  try {
    return readFileSync(contextPath, 'utf8').trim();
  } catch {
    return null;
  }
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildFixturesFile(baseUrl: string): string {
  return `import { test as base } from '@playwright/test';

export const TARGET_URL = ${JSON.stringify(baseUrl)};

export const test = base.extend<{ targetUrl: string }>({
  targetUrl: async ({}, use) => {
    await use(TARGET_URL);
  },
});

export { expect } from '@playwright/test';
`;
}

interface PageData {
  url: string;
  title: string;
  elements: Record<string, unknown>;
  accessibility_tree?: unknown;
}

function buildSystemPrompt(contextMd: string | null): string {
  let prompt =
    'You are an expert Playwright Test engineer (TypeScript). ' +
    'Generate a focused test file for a single page. ' +
    'Use accessibility-first locators (getByRole, getByLabel, getByText). ' +
    'Return ONLY the complete TypeScript file — no markdown fences, no explanation.';

  if (contextMd) {
    prompt += `\n\n${contextMd}`;
  }
  return prompt;
}

function buildPageTestPrompt(page: PageData, baseUrl: string): string {
  // Keep each section small so local models (llama3.2, mistral, etc.) don't
  // exceed their context window.  Cloud models handle the extra detail fine.
  const elementsJson = JSON.stringify(page.elements, null, 2).slice(0, 3_000);
  const accessibilityInfo = page.accessibility_tree
    ? `\nAccessibility tree (excerpt):\n${
        typeof page.accessibility_tree === 'string'
          ? page.accessibility_tree.slice(0, 3_000)
          : JSON.stringify(page.accessibility_tree, null, 2).slice(0, 3_000)
      }`
    : '';

  return (
    `Generate a Playwright test file for this page:\n` +
    `URL: ${page.url}\n` +
    `Title: ${page.title}\n` +
    `Base URL: ${baseUrl}\n` +
    `Elements: ${elementsJson}\n` +
    accessibilityInfo +
    `\n\nRules:\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Use getByRole, getByLabel, getByText — NEVER CSS class selectors\n` +
    `- Each test must be independent\n` +
    `- Include: page loads, title/heading visible, key elements present\n` +
    `- If the page has forms, add a test verifying form fields exist\n` +
    `- If the page has navigation links, add a test clicking one same-origin link\n` +
    `- If credentials are available in environment variables, write tests that use them to log in\n` +
    `- Return ONLY TypeScript code — no markdown fences, no explanation\n`
  );
}

// ── generateMultiFile ─────────────────────────────────────────────────────────

export interface GenerateMultiFileOptions {
  workspace: Workspace;
  pages: PageData[];
  baseUrl: string;
  model: ChatModel;
  maxConcurrent?: number;
}

export async function generateMultiFile(options: GenerateMultiFileOptions): Promise<string[]> {
  const { workspace, pages, baseUrl, model } = options;
  const testsDir = workspace.testsDir;
  mkdirSync(testsDir, { recursive: true });

  // Write shared fixtures file
  const fixturesPath = path.join(testsDir, 'fixtures.ts');
  writeFileSync(fixturesPath, buildFixturesFile(baseUrl), 'utf8');
  console.log(`  Wrote ${fixturesPath}`);

  // Read optional CONTEXT.md for credential injection
  const contextMd = readContextMd(workspace.dir);
  if (contextMd) {
    console.log('  Context detected — credentials will be included in test prompts.');
  }

  const systemPrompt = buildSystemPrompt(contextMd);
  const writtenFiles: string[] = [fixturesPath];

  for (const page of pages) {
    const fileName = urlToFileName(page.url, baseUrl);
    const filePath = path.join(testsDir, `${fileName}.spec.ts`);
    console.log(`  Generating tests for ${page.url} → ${fileName}.spec.ts`);

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: buildPageTestPrompt(page, baseUrl) },
      ];
      const result  = await model.invoke(messages);
      const cleaned = extractTypeScript(result);

      if (cleaned.includes('test(') || cleaned.includes('test.describe(')) {
        writeFileSync(filePath, cleaned, 'utf8');
        writtenFiles.push(filePath);
        console.log(`  Wrote ${filePath}`);
      } else {
        // Log the first 200 chars of the raw response so the user can see what the model returned
        const preview = result.slice(0, 200).replace(/\n/g, ' ');
        console.log(`  Skipped ${fileName} — output didn't look like a test file. Model returned: "${preview}"`);
      }
    } catch (e) {
      console.log(`  Failed to generate ${fileName}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return writtenFiles;
}

// ── runGenerateSuite ──────────────────────────────────────────────────────────

export interface RunGenerateSuiteOptions {
  url?: string;
  skipExplore: boolean;
  depth: number;
  maxPages: number;
  /** Claude model name string — only used when chatModel is not provided. */
  model: string;
  chatModel?: ChatModel;
  workspace: Workspace;
}

export async function runGenerateSuite(options: RunGenerateSuiteOptions): Promise<void> {
  const { workspace } = options;
  const siteMapPath = workspace.siteMapFile;

  let startUrl = options.url;

  if (!options.skipExplore) {
    if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
      throw new Error('URL required unless skipExplore is true.');
    }
    console.log('Generate suite — running explorer...');
    // Import lazily to avoid circular deps; runSiteExplorer is in the same lib
    const { runSiteExplorer } = await import('./site-explorer');
    await runSiteExplorer({
      url: startUrl,
      depth: options.depth,
      maxPages: options.maxPages,
      outputDir: workspace.dir,
    });
  } else {
    startUrl = startUrl || loadStartUrlFromSiteMap(siteMapPath);
    console.log(`Generate suite — skip explore, TARGET_URL will be ${startUrl}`);
  }

  if (!existsSync(siteMapPath)) {
    throw new Error(`Missing ${siteMapPath} — run exploration first.`);
  }

  const siteMap = JSON.parse(readFileSync(siteMapPath, 'utf8')) as {
    start_url?: string;
    pages?: { url: string; title: string; elements: Record<string, unknown>; accessibility_tree?: unknown }[];
  };

  if (!siteMap.pages?.length) {
    throw new Error('site_map.json has no pages.');
  }

  const effectiveStart = siteMap.start_url || startUrl!;

  // Use provided chatModel or create one from the model string
  const model = options.chatModel ?? await (async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    return createAnthropicModel({ apiKey, model: options.model });
  })();

  console.log('  Generating multi-file test suite...');
  await generateMultiFile({
    workspace,
    pages: siteMap.pages.map(p => ({
      url:               p.url,
      title:             p.title,
      elements:          p.elements,
      accessibility_tree: p.accessibility_tree,
    })),
    baseUrl: effectiveStart,
    model,
  });
  console.log('  Test suite generation complete.');
}

function loadStartUrlFromSiteMap(siteMapPath: string): string {
  if (!existsSync(siteMapPath)) {
    throw new Error(`Missing ${siteMapPath}. Run with a URL first or run explorer manually.`);
  }
  const raw = JSON.parse(readFileSync(siteMapPath, 'utf8')) as { start_url?: string };
  if (!raw.start_url) throw new Error('site_map.json has no start_url.');
  return raw.start_url;
}
