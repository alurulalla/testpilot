/**
 * triage-failures.ts
 *
 * Classifies each failing Playwright test as one of:
 *   test_bug  — selector/timing/URL issue in the test code itself
 *   app_bug   — test is correct but the application doesn't deliver what the docs say
 *   ambiguous — not enough signal to decide; heal conservatively
 *
 * The result is stored on the session so the UI can show clear badges
 * and the fix step can skip real app bugs instead of silently masking them.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Workspace } from '@/lib/pilot';
import type { ChatModel } from '@/lib/pilot';
import type { FailureAnalysis, FailureVerdict, TriageResult } from '@/types/session';

// ── Report parsing (mirrors fix-tests-per-file) ───────────────────────────────

interface SpecFailure { title: string; error: string }
interface FileFailures { file: string; failures: SpecFailure[] }

function collectFailures(
  suite: {
    file?: string;
    specs?: { title: string; tests?: { ok: boolean; results?: { error?: { message?: string; value?: string } }[] }[] }[];
    suites?: typeof suite[];
  },
  parentFile = '',
): FileFailures[] {
  const file = suite.file ?? parentFile;
  const result: FileFailures = { file: `tests/${file}`, failures: [] };

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (!test.ok) {
        const res = test.results?.[0];
        const msg = res?.error?.message ?? res?.error?.value ?? 'Unknown error';
        result.failures.push({
          title: spec.title,
          error: msg.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400),
        });
      }
    }
  }

  const nested = (suite.suites ?? []).flatMap(s => collectFailures(s, file));
  if (result.failures.length === 0 && nested.length === 0) return [];
  if (result.failures.length === 0) return nested;

  const merged = [result];
  for (const n of nested) {
    const existing = merged.find(m => m.file === n.file);
    if (existing) existing.failures.push(...n.failures);
    else merged.push(n);
  }
  return merged;
}

// ── LLM triage per file ───────────────────────────────────────────────────────

async function triageFile(
  file: string,
  failures: SpecFailure[],
  testContent: string,
  docContent: string | null,
  appUrl: string,
  model: ChatModel,
): Promise<FailureAnalysis[]> {
  const docSection = docContent
    ? `## Product Documentation\n${docContent.slice(0, 3000)}${docContent.length > 3000 ? '\n…(truncated)' : ''}`
    : '## Product Documentation\nNo documentation provided for this session.';

  const failureList = failures
    .slice(0, 15)
    .map(f => `### Test: "${f.title}"\nError: ${f.error}`)
    .join('\n\n');

  const prompt = `You are a senior QA engineer analysing Playwright test failures.

${docSection}

## Application URL
${appUrl}

## Failing Tests in \`${file}\`

${failureList}

## Test File Content
\`\`\`typescript
${testContent.slice(0, 4000)}${testContent.length > 4000 ? '\n// …truncated' : ''}
\`\`\`

## Your Task
Classify each failing test into exactly one of these verdicts:

- **test_bug** — The test code itself is wrong (broken CSS/text selector, wrong URL path, too-short timeout, wrong expected value that doesn't match what the app shows). The application behaviour is fine; the test needs fixing.
- **app_bug** — The test logic is sound and matches the documented feature, but the live application does not implement or expose that behaviour. Do NOT auto-heal this — it is a real product gap.
- **ambiguous** — Cannot determine from available information. Heal conservatively (fix selectors/timing only, never change what is asserted).

RULES:
1. Only classify as "app_bug" when the documentation explicitly describes the feature AND the error shows the app simply does not have it (missing element, unexpected redirect, empty page for a documented route).
2. Selector errors ("locator not found", "Element is not visible") are almost always **test_bug** unless the element is a core documented feature that clearly should exist.
3. When no documentation is available, use **test_bug** or **ambiguous** — never **app_bug** without docs.

Respond with ONLY valid JSON — no prose, no markdown fences:
{
  "analyses": [
    {
      "testName": "<exact test title from above>",
      "verdict": "test_bug" | "app_bug" | "ambiguous",
      "reasoning": "<one sentence>"
    }
  ]
}`;

  // Triage output is compact JSON — 4 096 tokens is more than enough.
  const raw = await model.invoke(
    [
      {
        role: 'system',
        content: 'You are a test failure analyst. Respond with valid JSON only. No markdown, no prose.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 4_096 },
  );

  // Parse JSON — strip any accidental fences
  const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as {
    analyses: { testName: string; verdict: string; reasoning: string }[];
  };

  return failures.map(f => {
    const match = parsed.analyses.find(
      a => a.testName === f.title || f.title.includes(a.testName) || a.testName.includes(f.title),
    );
    const verdict: FailureVerdict =
      match?.verdict === 'app_bug' ? 'app_bug'
      : match?.verdict === 'test_bug' ? 'test_bug'
      : 'ambiguous';

    return {
      testName: f.title,
      file,
      error: f.error,
      verdict,
      reasoning: match?.reasoning ?? 'Could not determine root cause.',
    };
  });
}

// ── Public function ───────────────────────────────────────────────────────────

export async function triageFailures(
  workspace: Workspace,
  docContent: string | null,
  appUrl: string,
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<TriageResult> {
  const reportPath = path.join(workspace.dir, 'reports', 'report.json');

  if (!existsSync(reportPath)) {
    onProgress?.('Triage: no report found, skipping.');
    return {
      analyses: [], testBugCount: 0, appBugCount: 0, ambiguousCount: 0,
      selfHealRecommended: false, triageAt: Date.now(),
    };
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    suites?: Parameters<typeof collectFailures>[0][];
  };

  const allFailures = (report.suites ?? []).flatMap(s => collectFailures(s));
  const withFailures = allFailures.filter(f => f.failures.length > 0);

  if (withFailures.length === 0) {
    return {
      analyses: [], testBugCount: 0, appBugCount: 0, ambiguousCount: 0,
      selfHealRecommended: false, triageAt: Date.now(),
    };
  }

  onProgress?.(`Triaging failures in ${withFailures.length} file(s)…`);

  const allAnalyses: FailureAnalysis[] = [];

  for (const { file, failures } of withFailures) {
    const fullPath = path.join(workspace.dir, file);
    const testContent = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';

    try {
      onProgress?.(`  Analysing ${file} (${failures.length} failure(s))…`);
      const fileAnalyses = await triageFile(file, failures, testContent, docContent, appUrl, model);
      allAnalyses.push(...fileAnalyses);
    } catch (err) {
      // If the LLM call fails, mark all failures in this file as ambiguous so they still get healed
      onProgress?.(`  ⚠ Triage failed for ${file}: ${err instanceof Error ? err.message : String(err)}`);
      failures.forEach(f =>
        allAnalyses.push({
          testName: f.title, file, error: f.error,
          verdict: 'ambiguous', reasoning: 'Triage call failed; defaulting to ambiguous.',
        }),
      );
    }
  }

  const testBugCount  = allAnalyses.filter(a => a.verdict === 'test_bug').length;
  const appBugCount   = allAnalyses.filter(a => a.verdict === 'app_bug').length;
  const ambiguousCount = allAnalyses.filter(a => a.verdict === 'ambiguous').length;

  const summary = [
    testBugCount  > 0 ? `${testBugCount} test bug(s)` : '',
    appBugCount   > 0 ? `${appBugCount} app bug(s)` : '',
    ambiguousCount > 0 ? `${ambiguousCount} ambiguous` : '',
  ].filter(Boolean).join(', ');
  onProgress?.(`Triage complete — ${summary || 'no failures classified'}.`);

  return {
    analyses: allAnalyses,
    testBugCount,
    appBugCount,
    ambiguousCount,
    selfHealRecommended: testBugCount > 0 || ambiguousCount > 0,
    triageAt: Date.now(),
  };
}
