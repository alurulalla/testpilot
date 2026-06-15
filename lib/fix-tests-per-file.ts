import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import type { ChatModel } from '@/lib/pilot';
import { isStopping } from '@/lib/session-store';
import type { FailureAnalysis } from '@/types/session';
import { extractTestError, NO_ERROR_DETAIL } from '@/lib/playwright-report';

// Robustly extract TypeScript code from an LLM response that may contain
// prose, analysis text, or markdown fences mixed with the actual code.
function extractTypeScript(response: string): string | null {
  // 1. Prefer an explicit ```typescript or ```ts code fence
  const fenced = response.match(/```(?:typescript|ts)\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // 2. Plain ``` fence
  const plainFence = response.match(/```\n([\s\S]*?)```/);
  if (plainFence) {
    const inner = plainFence[1].trim();
    if (inner.startsWith('import ') || inner.includes('test(')) return inner;
  }

  // 3. Response starts directly with TypeScript (ideal case)
  const trimmed = response.trim();
  if (trimmed.startsWith('import ')) return trimmed;

  // 4. Find where TypeScript actually begins (after prose paragraphs)
  const match = trimmed.match(/^(import\s[\s\S]+)/m);
  if (match) {
    const code = match[0].trim();
    if (code.includes('test(') || code.includes('test.describe(')) return code;
  }

  return null;
}

// ── Surgical test-block location ────────────────────────────────────────────
// Whole-file rewrites regress passing tests: the LLM can't reliably reproduce
// large unchanged blocks verbatim. So we locate ONLY the failing `test(...)`
// calls and splice in corrected versions, leaving every other byte untouched.

/**
 * Given the index of the '(' that opens a call, return the index just past the
 * matching ')'. Skips strings, template literals (incl. `${}`), and comments so
 * parens inside them don't throw off the count.
 */
function endOfCall(s: string, openIdx: number): number {
  let paren = 0;
  let mode: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
  const tplBrace: number[] = []; // brace depth saved on entering each `${`
  let brace = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    switch (mode) {
      case 'sq': if (c === '\\') i++; else if (c === "'") mode = 'code'; continue;
      case 'dq': if (c === '\\') i++; else if (c === '"') mode = 'code'; continue;
      case 'line': if (c === '\n') mode = 'code'; continue;
      case 'block': if (c === '*' && n === '/') { i++; mode = 'code'; } continue;
      case 'tpl':
        if (c === '\\') { i++; continue; }
        if (c === '`') { mode = 'code'; continue; }
        if (c === '$' && n === '{') { tplBrace.push(brace); brace++; i++; mode = 'code'; }
        continue;
    }
    // code mode
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'sq'; continue; }
    if (c === '"') { mode = 'dq'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '{') { brace++; continue; }
    if (c === '}') {
      if (tplBrace.length && brace - 1 === tplBrace[tplBrace.length - 1]) {
        tplBrace.pop(); brace--; mode = 'tpl'; continue; // closes a `${...}`
      }
      brace--; continue;
    }
    if (c === '(') { paren++; continue; }
    if (c === ')') { paren--; if (paren === 0) return i + 1; }
  }
  return s.length;
}

/** Locate a `test('title', …)` / `test.only(…)` / `it(…)` block by its title. */
function locateTestBlock(content: string, title: string): { start: number; end: number } | null {
  for (const q of ["'", '"', '`']) {
    const needle = `${q}${title}${q}`;
    let idx = content.indexOf(needle);
    while (idx !== -1) {
      let p = idx - 1;
      while (p >= 0 && /\s/.test(content[p])) p--;
      if (content[p] === '(') {
        let e = p - 1;
        while (e >= 0 && /\s/.test(content[e])) e--;
        let b = e;
        while (b >= 0 && /[\w.$]/.test(content[b])) b--;
        const ident = content.slice(b + 1, e + 1);
        if (/^(test|it)(\.(only|skip|fixme|fail))?$/.test(ident)) {
          const start = b + 1;
          const callEnd = endOfCall(content, p);
          let f = callEnd;
          while (f < content.length && /\s/.test(content[f])) f++;
          return { start, end: content[f] === ';' ? f + 1 : callEnd };
        }
      }
      idx = content.indexOf(needle, idx + 1);
    }
  }
  return null;
}

/** A replacement block is usable only if it's a single, balanced test() call. */
function isValidBlock(code: string): boolean {
  const t = code.trim();
  if (!/^(test|it)(\.(only|skip|fixme|fail))?\s*\(/.test(t)) return false;
  const open = t.indexOf('(');
  const end = endOfCall(t, open);
  // The call must consume essentially the whole block (allow a trailing ;).
  return end >= t.length - 2;
}

interface SpecFailure {
  title: string;
  error: string;
}

interface FileFailures {
  file: string;   // relative path, e.g. "tests/homepage.spec.ts"
  failures: SpecFailure[];
}

function collectFailures(suite: {
  file?: string;
  specs?: { title: string; tests?: { ok: boolean; results?: Parameters<typeof extractTestError>[0] }[] }[];
  suites?: typeof suite[];
}, parentFile?: string): FileFailures[] {
  const file = suite.file ?? parentFile ?? '';
  const result: FileFailures = { file: `tests/${file}`, failures: [] };

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (!test.ok) {
        result.failures.push({
          title: spec.title,
          error: (extractTestError(test.results) || NO_ERROR_DETAIL).slice(0, 600),
        });
      }
    }
  }

  const nested: FileFailures[] = (suite.suites ?? []).flatMap(s => collectFailures(s, file));

  if (result.failures.length === 0 && nested.length === 0) return [];
  if (result.failures.length === 0) return nested;

  // Merge nested failures into this file's entry if same file
  const merged = [result];
  for (const n of nested) {
    const existing = merged.find(m => m.file === n.file);
    if (existing) existing.failures.push(...n.failures);
    else merged.push(n);
  }
  return merged;
}

// ── Syntax-error fixer ────────────────────────────────────────────────────────

/**
 * Parse the raw Playwright/Node output for lines like:
 *   ReferenceError: test is not defined
 *   at user-authentication.spec.ts:8
 * and return the unique spec file names mentioned.
 */
function extractBrokenFileNames(output: string): string[] {
  const names = new Set<string>();
  // Match "at <filename>.spec.ts:<line>" — Node.js error stack format
  const atPattern = /at\s+([\w./-]+\.spec\.ts):\d+/g;
  let m;
  while ((m = atPattern.exec(output)) !== null) {
    names.add(m[1]);
  }
  // Also match Playwright's "at <filename>.spec.ts:line" without the "at" keyword
  // Format: "> <line> | code" with a filename header like "  × user-auth.spec.ts:8"
  const playwrightPattern = /[×✘×]\s+([\w./-]+\.spec\.ts):\d+/g;
  while ((m = playwrightPattern.exec(output)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * Static import sanitizer — fixes the most common syntax error (missing
 * `import { test }` from fixtures) without any LLM call.
 * Returns true if any file was modified.
 */
function applySanitizer(workspace: Workspace, onProgress?: (line: string) => void): boolean {
  const { testsDir } = workspace;
  if (!existsSync(testsDir)) return false;

  let anyFixed = false;
  for (const f of readdirSync(testsDir).filter(n => n.endsWith('.spec.ts'))) {
    const fullPath = path.join(testsDir, f);
    const original = readFileSync(fullPath, 'utf8');

    const hasTestUsage =
      /\btest\s*\(/.test(original) || /\btest\.describe\s*\(/.test(original);
    const hasFixturesTestImport =
      /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(original);

    if (!hasTestUsage || hasFixturesTestImport) continue;

    // Strip wrong-source imports then prepend canonical ones
    let fixed = original
      .replace(/^import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '')
      .replace(/^import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '');

    const hasTargetUrlImport =
      /import\s*\{[^}]*TARGET_URL[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(fixed);

    const prefix = hasTargetUrlImport
      ? `import { test, expect } from './fixtures.js';\n`
      : `import { test, expect } from './fixtures.js';\nimport { TARGET_URL } from './fixtures.js';\n`;

    writeFileSync(fullPath, prefix + fixed, 'utf8');
    onProgress?.(`  ✏ ${f} — added missing test/expect import`);
    anyFixed = true;
  }
  return anyFixed;
}

/**
 * Merge duplicate `import { … } from '@playwright/test'` statements into one,
 * deduping by the local binding name. This is the deterministic fix for the
 * "Identifier 'X' has already been declared" syntax error — e.g. a fixtures file
 * that imports `type Page` on one line and `Page` on another. Returns the deduped
 * text (unchanged when there's ≤1 such import).
 */
function dedupePlaywrightImports(content: string): string {
  const importRe = /^import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*$/gm;
  const matches = [...content.matchAll(importRe)];
  if (matches.length <= 1) return content;

  const seen = new Map<string, string>(); // local binding name → specifier text
  for (const m of matches) {
    for (const raw of m[1].split(',')) {
      const spec = raw.trim();
      if (!spec) continue;
      // Collisions are on the LOCAL name: 'test as base'→base, 'type Page'→Page.
      const local = spec.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      if (local && !seen.has(local)) seen.set(local, spec);
    }
  }
  const merged = `import { ${[...seen.values()].join(', ')} } from '@playwright/test';`;

  let first = true;
  return content
    .replace(importRe, () => (first ? ((first = false), merged) : ''))
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Dedupe @playwright/test imports across every file in the workspace's tests dir
 * (fixtures.ts AND specs) — auto-heal previously only touched *.spec.ts, so a
 * broken fixtures.ts looped forever. Returns true if any file changed.
 */
function dedupeWorkspaceImports(workspace: Workspace, onProgress?: (line: string) => void): boolean {
  const { testsDir } = workspace;
  if (!existsSync(testsDir)) return false;
  let anyFixed = false;
  for (const f of readdirSync(testsDir).filter(n => n.endsWith('.ts'))) {
    const full = path.join(testsDir, f);
    const before = readFileSync(full, 'utf8');
    const after = dedupePlaywrightImports(before);
    if (after !== before) {
      writeFileSync(full, after, 'utf8');
      onProgress?.(`  ✏ ${f} — merged duplicate @playwright/test imports`);
      anyFixed = true;
    }
  }
  return anyFixed;
}

/**
 * Auto-heal syntax / runtime errors in spec files.
 *
 * Step 0: dedupe duplicate @playwright/test imports (fixes a broken fixtures.ts).
 * Step 1: run the static import sanitizer (covers ~80 % of cases with no LLM).
 * Step 2: for any remaining broken files, call the LLM with the error context.
 *
 * Returns true if at least one file was changed.
 */
export async function fixSyntaxErrors(
  workspace: Workspace,
  errorOutput: string,
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<boolean> {
  // Step 0 — dedupe duplicate @playwright/test imports (incl. fixtures.ts)
  const deduped = dedupeWorkspaceImports(workspace, onProgress);

  // Step 1 — deterministic import sanitizer
  const sanitized = applySanitizer(workspace, onProgress);

  // Step 2 — identify files still mentioned in the error output and fix with LLM
  const brokenNames = extractBrokenFileNames(errorOutput);
  if (brokenNames.length === 0) return deduped || sanitized;

  let llmFixed = false;
  for (const name of brokenNames) {
    // name may be bare "user-authentication.spec.ts" or "tests/user-authentication.spec.ts"
    const candidates = [
      path.join(workspace.testsDir, path.basename(name)),
      path.join(workspace.dir, name),
    ];
    const fullPath = candidates.find(p => existsSync(p));
    if (!fullPath) { onProgress?.(`  ⚠ Could not find ${name} on disk`); continue; }

    const content = readFileSync(fullPath, 'utf8');
    const fileName = path.basename(fullPath);

    // Collect the error lines relevant to this file
    const errorLines = errorOutput
      .split('\n')
      .filter(l => l.includes(fileName) || l.includes('ReferenceError') || l.includes('SyntaxError') || l.includes('TypeError'))
      .slice(0, 10)
      .join('\n');

    onProgress?.(`  Fixing syntax errors in ${fileName}…`);
    try {
      const response = await model.invoke(
        [
          {
            role: 'system',
            content:
              'You are a Playwright test engineer. Fix the syntax/runtime errors in this spec file. ' +
              'Rules: import { test, expect } from \'./fixtures.js\'; ' +
              'import { TARGET_URL } from \'./fixtures.js\'; — never from \'@playwright/test\'. ' +
              'Output ONLY the complete corrected TypeScript file starting with the import line. ' +
              'No markdown fences, no explanations.',
          },
          {
            role: 'user',
            content:
              `Fix the errors in this file.\n\nERRORS:\n${errorLines}\n\nFILE: ${fileName}\n${content}`,
          },
        ],
        { maxTokens: 8_192 },
      );

      const code = extractTypeScript(response);
      if (code && (code.includes('test(') || code.includes('test.describe('))) {
        writeFileSync(fullPath, code, 'utf8');
        onProgress?.(`  ✓ Fixed ${fileName}`);
        llmFixed = true;
      } else {
        onProgress?.(`  ⚠ Could not extract valid TypeScript from LLM response for ${fileName}`);
      }
    } catch (e) {
      onProgress?.(`  ✗ LLM fix failed for ${fileName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return deduped || sanitized || llmFixed;
}

// Per-file autofix: sends one small LLM call per failing file instead of one
// giant call with all files. Much safer for free-tier token rate limits.
// Pass sessionId to respect stop requests between files.
// Pass triageAnalyses to skip failures classified as app_bug (real product gaps —
// auto-healing them would just mask a real issue, not fix it).
export async function fixTestsPerFile(
  workspace: Workspace,
  model: ChatModel,
  onProgress?: (line: string) => void,
  sessionId?: string,
  triageAnalyses?: FailureAnalysis[],
): Promise<{ fixed: boolean; filesChanged: number; skippedAppBugs: number }> {
  const reportPath = path.join(workspace.dir, 'reports', 'report.json');
  if (!existsSync(reportPath)) {
    onProgress?.('No report found — run tests first.');
    return { fixed: false, filesChanged: 0, skippedAppBugs: 0 };
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    suites?: Parameters<typeof collectFailures>[0][];
  };

  // Gather failures grouped by file
  const allFailures: FileFailures[] = (report.suites ?? []).flatMap(s => collectFailures(s));

  const withFailures = allFailures.filter(f => f.failures.length > 0);
  if (withFailures.length === 0) {
    onProgress?.('No failures found in report.');
    return { fixed: false, filesChanged: 0, skippedAppBugs: 0 };
  }

  // When triage is available, separate healable failures (test_bug / ambiguous)
  // from ones healing can't fix: app_bug (real product gap) and setup_error
  // (login/auth/env — fixing the test body won't help; surfaced to the user).
  let skippedAppBugs = 0;
  let skippedSetup = 0;
  const healableFiles = withFailures.map(({ file, failures }) => {
    if (!triageAnalyses || triageAnalyses.length === 0) return { file, failures };

    const healable = failures.filter(f => {
      const analysis = triageAnalyses.find(
        a => a.file === file && (a.testName === f.title || f.title.includes(a.testName)),
      );
      if (analysis?.verdict === 'app_bug') {
        skippedAppBugs++;
        return false; // skip — real product gap, not a test code issue
      }
      if (analysis?.verdict === 'setup_error') {
        skippedSetup++;
        return false; // skip — login/auth/env issue, not fixable by editing the test
      }
      return true;
    });
    return { file, failures: healable };
  }).filter(f => f.failures.length > 0);

  if (skippedAppBugs > 0) {
    onProgress?.(`⚠ Skipping ${skippedAppBugs} app bug(s) — these reflect real application gaps, not test code issues.`);
  }
  if (skippedSetup > 0) {
    onProgress?.(`⚠ Skipping ${skippedSetup} setup/auth error(s) — fix credentials or login selectors; healing the test body won't help.`);
  }

  if (healableFiles.length === 0) {
    onProgress?.('No healable test-code issues — remaining failures are app bugs or setup/auth errors.');
    return { fixed: false, filesChanged: 0, skippedAppBugs };
  }

  onProgress?.(`Fixing ${healableFiles.length} file(s) with healable failures…`);
  let filesChanged = 0;

  for (const { file, failures } of healableFiles) {
    if (sessionId && isStopping(sessionId)) {
      onProgress?.('Stopped by user.');
      break;
    }
    const fullPath = path.join(workspace.dir, file);
    if (!existsSync(fullPath)) {
      onProgress?.(`Skipping ${file} — not found on disk`);
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');
    onProgress?.(`Fixing ${file} (${failures.length} failure(s))…`);

    try {
      const updated = await healFileSurgically(content, file, failures, model, onProgress);
      if (updated && updated !== content) {
        writeFileSync(fullPath, updated, 'utf8');
        filesChanged++;
        onProgress?.(`  ✓ Fixed ${file}`);
      } else if (!updated) {
        onProgress?.(`  ⚠ Skipped ${file} — could not produce a safe fix`);
      } else {
        onProgress?.(`  • No change applied to ${file}`);
      }
    } catch (err) {
      onProgress?.(`  ✗ Failed to fix ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fixed: filesChanged > 0, filesChanged, skippedAppBugs };
}

/**
 * Heal a single file WITHOUT rewriting it: fix only the failing `test(...)`
 * blocks and splice them back into the original content. Passing tests are
 * never sent to the model and never modified, so they can't regress.
 *
 * Falls back to a full-file rewrite only when not a single failing block can be
 * located (e.g. unusual formatting) — there's nothing to protect in that case.
 */
async function healFileSurgically(
  content: string,
  file: string,
  failures: { title: string; error: string }[],
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<string | null> {
  const located = failures
    .slice(0, 20)
    .map(f => ({ ...f, loc: locateTestBlock(content, f.title) }))
    .filter((f): f is typeof f & { loc: { start: number; end: number } } => !!f.loc);

  // Couldn't find any failing block → fall back to the old whole-file rewrite.
  if (located.length === 0) {
    onProgress?.(`  ⚠ ${file}: could not locate failing test blocks — rewriting whole file.`);
    return rewriteWholeFile(content, file, failures, model);
  }

  const blocks = located.map((f, i) =>
    `### ${i + 1}. "${f.title}"\nError: ${f.error}\nCurrent block:\n${content.slice(f.loc.start, f.loc.end)}`,
  ).join('\n\n');

  const raw = await model.invoke(
    [
      {
        role: 'system',
        content: 'You are a Playwright engineer. Respond with ONLY valid JSON — no markdown, no prose.',
      },
      {
        role: 'user',
        content:
          `Below is a Playwright test file FOR REFERENCE ONLY — do not rewrite it:\n\n` +
          `\`\`\`typescript\n${content.slice(0, 6000)}\n\`\`\`\n\n` +
          `Fix ONLY the failing tests listed below. For each, return the COMPLETE corrected ` +
          `test(...) block (from "test(" through its closing "});"), keeping the exact same test ` +
          `title. Correct selectors, expected values, or waits. Do NOT touch any other test.\n\n` +
          `${blocks}\n\n` +
          `Respond with ONLY JSON:\n` +
          `{"fixes":[{"title":"<exact title>","code":"<full corrected test(...) block>"}]}`,
      },
    ],
    { maxTokens: 8_192 },
  );

  let parsed: { fixes?: { title: string; code: string }[] };
  try {
    parsed = JSON.parse(raw.replace(/```(?:json)?\n?/g, '').trim());
  } catch {
    onProgress?.(`  ⚠ ${file}: fix response was not valid JSON — leaving file unchanged.`);
    return content;
  }

  let out = content;
  let applied = 0;
  for (const fix of parsed.fixes ?? []) {
    if (!fix?.title || !fix?.code || !isValidBlock(fix.code)) continue;
    // Re-locate in the (possibly already spliced) content so indices stay valid.
    const loc = locateTestBlock(out, fix.title);
    if (!loc) continue;
    out = out.slice(0, loc.start) + fix.code.trim() + out.slice(loc.end);
    applied++;
  }

  if (applied === 0) {
    onProgress?.(`  ⚠ ${file}: no valid replacement blocks returned — leaving file unchanged.`);
    return content;
  }
  return out;
}

/** Legacy whole-file rewrite — used only when no failing block can be located. */
async function rewriteWholeFile(
  content: string,
  file: string,
  failures: { title: string; error: string }[],
  model: ChatModel,
): Promise<string | null> {
  const failureSummary = failures.slice(0, 20).map(f => `• ${f.title}\n  ${f.error}`).join('\n\n');
  const result = await model.invoke(
    [
      {
        role: 'system',
        content:
          'You are a Playwright test engineer. Output ONLY valid TypeScript. ' +
          'Your response must start with an import statement. No prose, no fences.',
      },
      {
        role: 'user',
        content:
          `Rewrite this Playwright test file fixing the listed failures. ` +
          `Keep all passing tests EXACTLY as written (byte-for-byte). Fix failing ones by ` +
          `correcting expected values, selectors, or waits.\n\n` +
          `FILE: ${file}\n${content}\n\nFAILURES:\n${failureSummary}\n\n` +
          `Output the complete fixed TypeScript file starting with the import line.`,
      },
    ],
    { maxTokens: 8_192 },
  );
  return extractTypeScript(result);
}
