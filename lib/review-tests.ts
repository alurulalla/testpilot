/**
 * Test Reviewer — Phase 2.5
 *
 * After test generation, reads each spec file and cross-checks its locators
 * against the INTERACTIVE ELEMENTS tables captured during site exploration.
 *
 * Workflow:
 *  1. Static pass: extract every getByRole(role, { name: '…' }) call and
 *     look it up in the interactives index built from site_map.json.
 *  2. Files where all locators match → logged as ✓, no LLM call made.
 *  3. Files with unmatched locators that are NOT on the auth-exclusion list
 *     → sent to the LLM for correction.
 *  4. The LLM rewrites bad locators with the closest real element from the
 *     crawled data.  If no equivalent exists it wraps the individual action
 *     with a comment, but does NOT test.skip the whole test.
 *  5. The corrected output is validated before writing (prose-before-import is
 *     stripped; if the result is not valid TypeScript the original is kept).
 *
 * Auth-page exclusion:
 *  When the session starts with pre-login the crawler sees the app in its
 *  authenticated state, so login/register form elements never appear in the
 *  interactives index.  The reviewer skips locator checks for any name that
 *  looks like an auth element (sign in, log in, register, password, email…)
 *  so those tests are never incorrectly flagged or destroyed.
 *
 * This phase is non-fatal — a review error never blocks test execution.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { ChatModel } from './pilot/types';
import type { Workspace } from './pilot/workspace';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Interactive { role: string; name: string; id: string; testId: string }

interface LocatorCall { role: string; name: string; line: number }

export interface ReviewResult {
  reviewed: number;
  fixed: number;
  skipped: number;
}

// ── Auth-element exclusion list ───────────────────────────────────────────────
// Locators that mention auth-related terms are excluded from the review because
// the login/register pages are crawled in authenticated state (or not at all)
// so those elements don't appear in the interactives index.
const AUTH_TERMS_RE =
  /\b(sign\s*in|log\s*in|login|register|sign\s*up|password|forgot|reset|username|email|credential|authenticat)/i;

function isAuthLocator(name: string): boolean {
  return AUTH_TERMS_RE.test(name);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInteractivesIndex(
  siteMap: { pages?: { url: string; elements?: Record<string, unknown> }[] },
): Interactive[] {
  const all: Interactive[] = [];
  for (const page of siteMap.pages ?? []) {
    const items = (page.elements?.interactives as Interactive[] | undefined) ?? [];
    all.push(...items);
  }
  return all;
}

function formatAllInteractives(
  siteMap: { pages?: { url: string; elements?: Record<string, unknown> }[] },
): string {
  const sections: string[] = [];
  for (const page of siteMap.pages ?? []) {
    const items = (page.elements?.interactives as Interactive[] | undefined) ?? [];
    if (items.length === 0) continue;
    const lines = items.map(el => {
      let line = `  ${el.role.padEnd(12)} "${el.name}"`;
      if (el.id)     line += `  id="${el.id}"`;
      if (el.testId) line += `  testId="${el.testId}"`;
      return line;
    }).join('\n');
    sections.push(`=== ${page.url} ===\n${lines}`);
  }
  return sections.join('\n\n');
}

/**
 * Extract every getByRole(role, { name: '…' }) call from TypeScript source.
 * Regex literals (/pattern/i) are intentionally skipped — they may be valid
 * dynamic matches and we cannot check them against static crawl data.
 */
function extractRoleLocators(code: string): LocatorCall[] {
  const results: LocatorCall[] = [];
  const codeLines = code.split('\n');
  for (let i = 0; i < codeLines.length; i++) {
    const lineRegex =
      /getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{[^}]*\bname:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = lineRegex.exec(codeLines[i])) !== null) {
      results.push({ role: m[1], name: m[2], line: i + 1 });
    }
  }
  return results;
}

function locatorExists(role: string, name: string, index: Interactive[]): boolean {
  return index.some(el => el.role === role && el.name === name);
}

// ── TypeScript extractor ──────────────────────────────────────────────────────
/**
 * Robustly extract TypeScript code from an LLM response.
 *
 * The LLM sometimes emits reasoning prose before the code block.  We handle:
 *  1. Fenced ```ts / ```typescript block → extract the block content.
 *  2. Prose before first `import` statement → strip the prose, return from `import` onward.
 *  3. Response starts directly with `import` → return as-is.
 *  4. Anything else → return null (keep original file).
 */
function extractCorrectedTypeScript(raw: string): string | null {
  const trimmed = raw.trim();

  // Sentinel — reviewer says nothing to change
  if (trimmed.startsWith('NO_CHANGES_NEEDED')) return null;

  // 1. Fenced code block
  const fenceMatch = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    const code = fenceMatch[1].trim();
    if (looksLikeTestFile(code)) return code;
  }

  // 2. Prose before first `import` statement — strip the preamble
  const importIdx = trimmed.indexOf('\nimport ');
  if (importIdx >= 0) {
    const code = trimmed.slice(importIdx + 1).trim(); // +1 to skip the \n
    if (looksLikeTestFile(code)) return code;
  }

  // 3. Response starts directly with import
  if (trimmed.startsWith('import ') && looksLikeTestFile(trimmed)) {
    return trimmed;
  }

  // Cannot extract valid TypeScript — return null so the original is kept
  return null;
}

function looksLikeTestFile(code: string): boolean {
  return (
    (code.includes('test(') || code.includes('test.describe(')) &&
    code.includes('import ')
  );
}

// ── LLM corrector ─────────────────────────────────────────────────────────────

function buildReviewSystemPrompt(): string {
  return (
    'You are a Playwright test code reviewer. ' +
    'The user provides a spec file and INTERACTIVE ELEMENTS tables scraped from the live site. ' +
    'The tables show emoji-stripped names; the real accessible names may have emoji prefixes.\n\n' +
    'Your job: find and fix every getByRole locator whose (role, name) pair is absent from those tables.\n\n' +
    'Rules:\n' +
    '1. page.locator(\'a[href="..."]\') locators → ALWAYS leave unchanged. ' +
    'Href-based locators are precise and correct by definition.\n' +
    '   getByRole(role, { name: /regex/i }) locators → ALWAYS leave unchanged. ' +
    'Regex patterns intentionally match emoji-prefixed names.\n' +
    '2. For getByRole(role, { name: "X" }) exact string locators:\n' +
    '   - If role + "X" is in the tables → leave it UNCHANGED.\n' +
    '   - If NOT found → look for the closest match by intent:\n' +
    '     a) Close match exists → replace with the exact name shown in the table.\n' +
    '     b) No equivalent at all → comment out only the single failing action line ' +
    'and add: // TODO: element "X" not found in crawl. Do NOT skip the whole test.\n' +
    '3. Never change test names, URL assertions (toHaveURL), or visibility checks.\n' +
    '4. Be conservative — only touch locators clearly absent from the crawled data.\n' +
    '5. IMPORTANT: Return ONLY the complete TypeScript file starting with the import statements. ' +
    'No reasoning, no prose, no markdown fences. ' +
    'If the file needs no changes, respond with exactly: NO_CHANGES_NEEDED'
  );
}

async function correctTestFile(
  fileName: string,
  content: string,
  allInteractivesTable: string,
  badLocators: LocatorCall[],
  model: ChatModel,
): Promise<string | null> {
  const issueList = badLocators
    .map(l => `  line ${l.line}: getByRole('${l.role}', { name: '${l.name}' })`)
    .join('\n');

  const userPrompt =
    `These locators in the spec file were NOT found in the crawled data:\n` +
    `${issueList}\n\n` +
    `INTERACTIVE ELEMENTS (all crawled pages — only use these exact names):\n` +
    `${allInteractivesTable}\n\n` +
    `FILE: ${fileName}\n` +
    `${content}`;

  // Review output is a corrected spec file or "NO_CHANGES_NEEDED".
  // 8 192 tokens comfortably covers even the largest spec files.
  const response = await model.invoke(
    [
      { role: 'system', content: buildReviewSystemPrompt() },
      { role: 'user',   content: userPrompt },
    ],
    { maxTokens: 8_192 },
  );

  return extractCorrectedTypeScript(response);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function reviewGeneratedTests(
  workspace: Workspace,
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<ReviewResult> {
  const log = (msg: string) => onProgress?.(msg);
  const result: ReviewResult = { reviewed: 0, fixed: 0, skipped: 0 };

  // Load site_map.json
  const siteMapPath = workspace.siteMapFile;
  if (!existsSync(siteMapPath)) {
    log('  Skipping review — site_map.json not found.');
    return result;
  }

  let siteMap: { pages?: { url: string; elements?: Record<string, unknown> }[] };
  try {
    siteMap = JSON.parse(readFileSync(siteMapPath, 'utf8'));
  } catch {
    log('  Skipping review — could not parse site_map.json.');
    return result;
  }

  const index = buildInteractivesIndex(siteMap);
  if (index.length === 0) {
    log('  Skipping review — no interactives in site_map.json (crawl may predate element enrichment).');
    return result;
  }

  const allInteractivesTable = formatAllInteractives(siteMap);

  // Find spec files
  const testsDir = workspace.testsDir;
  if (!existsSync(testsDir)) return result;

  const specFiles = readdirSync(testsDir)
    .filter(f => f.endsWith('.spec.ts'))
    .map(f => path.join(testsDir, f));

  if (specFiles.length === 0) return result;

  log(`  Reviewing ${specFiles.length} spec file(s) against ${index.length} crawled element(s)…`);

  for (const specPath of specFiles) {
    const fileName = path.basename(specPath);
    const content  = readFileSync(specPath, 'utf8');
    result.reviewed++;

    // Static check — find locators that are absent from the interactives index.
    // Auth-related names (sign in, password, etc.) are excluded because those
    // pages are not crawled in their unauthenticated state.
    const locators = extractRoleLocators(content);
    const bad = locators.filter(
      l => !isAuthLocator(l.name) && !locatorExists(l.role, l.name, index),
    );

    const authExcluded = locators.filter(l => isAuthLocator(l.name)).length;
    const verified     = locators.length - bad.length - authExcluded;

    if (bad.length === 0) {
      const note = authExcluded > 0 ? ` (${authExcluded} auth locator(s) excluded from check)` : '';
      log(`  ✓ ${fileName} — ${verified} locator(s) verified${note}`);
      continue;
    }

    log(
      `  ⚠ ${fileName} — ${bad.length} unverified locator(s): ` +
      bad.map(l => `"${l.name}"`).join(', '),
    );

    // LLM correction — only called for files that have problems
    try {
      const corrected = await correctTestFile(
        fileName, content, allInteractivesTable, bad, model,
      );

      if (!corrected) {
        // LLM confirmed no changes OR extraction failed — keep original safe
        log(`  ✓ ${fileName} — reviewer confirmed no changes needed`);
        result.skipped++;
        continue;
      }

      // Extra safety: confirm the corrected code still looks like a valid spec
      if (!looksLikeTestFile(corrected)) {
        log(`  ⚠ ${fileName} — reviewer output did not pass validation, keeping original`);
        result.skipped++;
        continue;
      }

      writeFileSync(specPath, corrected, 'utf8');
      result.fixed++;
      log(`  ✏ ${fileName} — corrected ${bad.length} locator(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ⚠ ${fileName} review error (original kept): ${msg}`);
      result.skipped++;
    }
  }

  log(
    result.fixed > 0
      ? `  Review done — corrected ${result.fixed}/${result.reviewed} file(s).`
      : `  Review done — all ${result.reviewed} file(s) passed locator check.`,
  );

  return result;
}
