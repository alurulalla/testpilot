import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import type { ChatModel } from '@/lib/pilot';
import { isStopping } from '@/lib/session-store';

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

// Per-file autofix: sends one small LLM call per failing file instead of one
// giant call with all files. Much safer for free-tier token rate limits.
// Pass sessionId to respect stop requests between files.
export async function fixTestsPerFile(
  workspace: Workspace,
  model: ChatModel,
  onProgress?: (line: string) => void,
  sessionId?: string,
): Promise<{ fixed: boolean; filesChanged: number }> {
  const reportPath = path.join(workspace.dir, 'reports', 'report.json');
  if (!existsSync(reportPath)) {
    onProgress?.('No report found — run tests first.');
    return { fixed: false, filesChanged: 0 };
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    suites?: Parameters<typeof collectFailures>[0][];
  };

  // Gather failures grouped by file
  const allFailures: FileFailures[] = (report.suites ?? []).flatMap(s => collectFailures(s));

  const withFailures = allFailures.filter(f => f.failures.length > 0);
  if (withFailures.length === 0) {
    onProgress?.('No failures found in report.');
    return { fixed: false, filesChanged: 0 };
  }

  onProgress?.(`Fixing ${withFailures.length} file(s) with failures…`);
  let filesChanged = 0;

  for (const { file, failures } of withFailures) {
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
      const result = await model.invoke([
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
      ]);

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

  return { fixed: filesChanged > 0, filesChanged };
}
