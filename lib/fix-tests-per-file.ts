import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import type { ChatModel } from '@/lib/pilot';
import { isStopping } from '@/lib/session-store';
import type { FailureAnalysis } from '@/types/session';

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
  specs?: { title: string; tests?: { ok: boolean; results?: { error?: { message?: string; value?: string } }[] }[] }[];
  suites?: typeof suite[];
}, parentFile?: string): FileFailures[] {
  const file = suite.file ?? parentFile ?? '';
  const result: FileFailures = { file: `tests/${file}`, failures: [] };

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (!test.ok) {
        const res = test.results?.[0];
        const msg = res?.error?.message ?? res?.error?.value ?? 'Unknown error';
        // Strip ANSI codes and truncate
        const clean = msg.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400);
        result.failures.push({ title: spec.title, error: clean });
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
 * Auto-heal syntax / runtime errors in spec files.
 *
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
  // Step 1 — deterministic import sanitizer
  const sanitized = applySanitizer(workspace, onProgress);

  // Step 2 — identify files still mentioned in the error output and fix with LLM
  const brokenNames = extractBrokenFileNames(errorOutput);
  if (brokenNames.length === 0) return sanitized;

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

  return sanitized || llmFixed;
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

  // When triage is available, separate healable failures from real app bugs
  let skippedAppBugs = 0;
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
      return true;
    });
    return { file, failures: healable };
  }).filter(f => f.failures.length > 0);

  if (skippedAppBugs > 0) {
    onProgress?.(`⚠ Skipping ${skippedAppBugs} app bug(s) — these reflect real application gaps, not test code issues.`);
  }

  if (healableFiles.length === 0) {
    onProgress?.('All failures are application bugs. Nothing to auto-heal.');
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
    const failureSummary = failures
      .slice(0, 20) // cap at 20 failures per file to keep prompt small
      .map(f => `• ${f.title}\n  ${f.error}`)
      .join('\n\n');

    onProgress?.(`Fixing ${file} (${failures.length} failure(s))…`);

    try {
      const result = await model.invoke(
        [
          {
            role: 'system',
            content:
              'You are a Playwright test engineer. Output ONLY valid TypeScript. ' +
              'Your response must start with an import statement. ' +
              'No explanations, no analysis, no markdown fences, no prose. ' +
              'Just the raw TypeScript file content, nothing else.',
          },
          {
            role: 'user',
            content:
              `Rewrite this Playwright test file fixing the listed failures. ` +
              `Keep all passing tests unchanged. Fix failing ones by correcting ` +
              `expected values, selectors, or removing unfixable tests.\n\n` +
              `FILE: ${file}\n${content}\n\n` +
              `FAILURES:\n${failureSummary}\n\n` +
              `Output the complete fixed TypeScript file starting with the import line.`,
          },
        ],
        { maxTokens: 8_192 },
      );

      const code = extractTypeScript(result);
      if (code) {
        writeFileSync(fullPath, code, 'utf8');
        filesChanged++;
        onProgress?.(`  ✓ Fixed ${file}`);
      } else {
        onProgress?.(`  ⚠ Skipped ${file} — could not extract TypeScript from response`);
      }
    } catch (err) {
      onProgress?.(`  ✗ Failed to fix ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fixed: filesChanged > 0, filesChanged, skippedAppBugs };
}
