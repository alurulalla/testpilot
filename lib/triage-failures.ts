/**
 * triage-failures.ts — two-stage failure analysis.
 *
 * Classifies each failing Playwright test as one of:
 *   test_bug    — selector/timing/URL/value issue in the test code itself
 *   app_bug     — test is correct but the app doesn't deliver the documented behaviour
 *   setup_error — login/auth/env/fixture failure; the test never reached its asserts
 *   ambiguous   — not enough signal to decide; heal conservatively
 *
 * Design (why this is not one big LLM prompt):
 *   Stage 1 — a deterministic rule engine reads the structured Playwright error
 *             (kind, locator, expected/received, login/timeout markers) and
 *             assigns a verdict + confidence with ZERO tokens. Most failures have
 *             an unambiguous signature (broken selector, login threw, can't reach
 *             the site), so this resolves the majority instantly and explainably.
 *   Cluster — failures are grouped by error signature. A login failure cascades
 *             into dozens of identical failures; we report ONE root cause, not 40
 *             cards. This is what stops "everything is Ambiguous".
 *   Stage 2 — only clusters the rules can't resolve confidently are escalated to
 *             the LLM, and we send ONE representative per cluster (keyed by a
 *             stable integer id, not a fuzzy title match). A parse failure falls
 *             back to the rule verdict — never a blanket "ambiguous".
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Workspace } from '@/lib/pilot';
import type { ChatModel } from '@/lib/pilot';
import type {
  FailureAnalysis, FailureVerdict, TriageResult, TriageCluster,
} from '@/types/session';
import { extractTestError, NO_ERROR_DETAIL } from '@/lib/playwright-report';

// ── Report parsing ─────────────────────────────────────────────────────────────

interface SpecFailure { title: string; error: string; file: string }
interface FileFailures { file: string; failures: SpecFailure[] }

interface ReportTest { status?: string; results?: Parameters<typeof extractTestError>[0] }
interface ReportSpec { title: string; ok?: boolean; tests?: ReportTest[] }

function collectFailures(
  suite: { file?: string; specs?: ReportSpec[]; suites?: typeof suite[] },
  parentFile = '',
): FileFailures[] {
  const file = suite.file ?? parentFile;
  const relFile = `tests/${file}`;
  const result: FileFailures = { file: relFile, failures: [] };

  for (const spec of suite.specs ?? []) {
    // Playwright marks the FINAL outcome on spec.ok (incl. retries). The inner
    // test objects carry `status`, not `ok` — checking `test.ok` (as the old
    // code did) treated every passing test as a failure too.
    if (spec.ok !== false) continue;
    const failing =
      (spec.tests ?? []).find(t => t.status !== 'expected' && t.status !== 'skipped')
      ?? spec.tests?.[0];
    result.failures.push({
      title: spec.title,
      file: relFile,
      error: (extractTestError(failing?.results) || NO_ERROR_DETAIL).slice(0, 800),
    });
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

// ── Structured error signal ─────────────────────────────────────────────────────

type ErrorKind =
  | 'setup'          // login() threw / still on login page
  | 'navigation'     // couldn't reach the app (net::ERR, goto failed)
  | 'selector-missing' // locator resolved to 0 elements / not found / strict-mode
  | 'assertion-visible'
  | 'assertion-url'
  | 'assertion-text'
  | 'assertion-attr'
  | 'assertion-count'
  | 'timeout'        // generic test timeout, no assertion identified
  | 'other';

interface ErrorSignal {
  kind: ErrorKind;
  locator: string | null;
  expected: string | null;
  received: string | null;
  isTimeout: boolean;
}

function grab(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1].trim().slice(0, 120) : null;
}

function parseError(error: string): ErrorSignal {
  const e = error;
  const locator = grab(/Locator:\s*(.+)/, e);
  const expected = grab(/Expected(?: pattern| string)?:\s*(.+)/, e);
  const received = grab(/Received(?: string)?:\s*(.+)/, e);
  const isTimeout = /Test timeout of \d+ms exceeded|exceeded while|Timeout \d+ms exceeded/i.test(e);

  const isLogin =
    /login\(\):/i.test(e) ||
    /still on the login page/i.test(e) ||
    /no credentials configured/i.test(e) ||
    /username field not found/i.test(e) ||
    /fixtures\.(?:t|j)s/i.test(e);
  const isNav = /net::ERR|ERR_[A-Z_]+|page\.goto|Navigation (?:failed|to)|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(e);

  let kind: ErrorKind = 'other';
  if (isLogin) kind = 'setup';
  else if (isNav) kind = 'navigation';
  else if (/resolved to 0 elements|waiting for locator|strict mode violation|not found|No node found|element\(s\) not found/i.test(e)) kind = 'selector-missing';
  else if (/toBeVisible|toBeHidden|toBeInViewport|toBeAttached/i.test(e)) kind = 'assertion-visible';
  else if (/toHaveURL/i.test(e)) kind = 'assertion-url';
  else if (/toHaveText|toContainText|toHaveValue|toHaveTitle/i.test(e)) kind = 'assertion-text';
  else if (/toHaveAttribute|toHaveClass|toHaveCSS/i.test(e)) kind = 'assertion-attr';
  else if (/toHaveCount/i.test(e)) kind = 'assertion-count';
  else if (isTimeout) kind = 'timeout';

  return { kind, locator, expected, received, isTimeout };
}

// ── Stage 1: deterministic classifier ───────────────────────────────────────────

interface RuleVerdict {
  verdict: FailureVerdict;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** Signature used to cluster failures sharing a root cause. */
  signature: string;
}

/** Collapse dynamic bits so similar locators cluster together. */
function normSig(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/['"]/g, '')
    .replace(/\d+/g, '#')          // item_4_title → item_#_title
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function classify(sig: ErrorSignal, hasDoc: boolean): RuleVerdict {
  switch (sig.kind) {
    case 'setup':
      return {
        verdict: 'setup_error', confidence: 'high', signature: 'setup',
        reasoning: 'Login/setup fixture failed — the test never reached its assertions. Fix credentials or login selectors.',
      };
    case 'navigation':
      return {
        verdict: 'setup_error', confidence: 'high', signature: 'navigation',
        reasoning: 'The application could not be reached (navigation/network error). Check the target URL and environment.',
      };
    case 'selector-missing':
      return {
        verdict: 'test_bug', confidence: 'high', signature: `selector-missing|${normSig(sig.locator)}`,
        reasoning: `Locator ${sig.locator ?? ''} matched no elements — broken or stale selector in the test.`.trim(),
      };
    case 'assertion-visible':
      // Element expected visible wasn't. Most often a selector/state issue (test_bug),
      // but with docs it could be a genuine missing feature → let the LLM weigh in.
      return {
        verdict: 'test_bug', confidence: hasDoc ? 'low' : 'medium',
        signature: `visible|${normSig(sig.locator)}`,
        reasoning: `Element ${sig.locator ?? ''} was expected visible but was not found/visible.`.trim(),
      };
    case 'assertion-url':
      return {
        verdict: 'test_bug', confidence: 'low', signature: `url|${normSig(sig.expected)}`,
        reasoning: `Navigation did not reach the expected URL (expected ${sig.expected ?? '?'}, got ${sig.received ?? '?'}).`,
      };
    case 'assertion-text':
    case 'assertion-attr':
    case 'assertion-count':
      return {
        verdict: 'test_bug', confidence: 'low',
        signature: `${sig.kind}|${normSig(sig.expected)}`,
        reasoning: `Assertion mismatch (expected ${sig.expected ?? '?'}, got ${sig.received ?? '?'}) — wrong expectation or a real app difference.`,
      };
    case 'timeout':
      return {
        verdict: 'test_bug', confidence: 'low', signature: 'timeout',
        reasoning: 'Test timed out — likely a slow/incorrect wait or selector, possibly app slowness.',
      };
    default:
      return {
        verdict: 'ambiguous', confidence: 'low', signature: 'other',
        reasoning: 'No clear signal in the error output.',
      };
  }
}

// ── Clustering ───────────────────────────────────────────────────────────────────

interface WorkItem {
  failure: SpecFailure;
  signal: ErrorSignal;
  rule: RuleVerdict;
}

interface Cluster {
  id: string;
  signature: string;
  verdict: FailureVerdict;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  items: WorkItem[];
  files: Set<string>;
  representative: WorkItem;
}

function buildClusters(items: WorkItem[]): Cluster[] {
  const bySig = new Map<string, Cluster>();
  let n = 0;
  for (const it of items) {
    const key = it.rule.signature;
    let c = bySig.get(key);
    if (!c) {
      c = {
        id: `c${++n}`, signature: key, verdict: it.rule.verdict,
        confidence: it.rule.confidence, reasoning: it.rule.reasoning,
        items: [], files: new Set(), representative: it,
      };
      bySig.set(key, c);
    }
    c.items.push(it);
    c.files.add(it.failure.file);
  }
  return [...bySig.values()].sort((a, b) => b.items.length - a.items.length);
}

// ── Stage 2: LLM only for low-confidence clusters ────────────────────────────────

async function classifyClustersWithLLM(
  clusters: Cluster[],
  fileContent: (file: string) => string,
  docContent: string | null,
  appUrl: string,
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<void> {
  if (clusters.length === 0) return;

  const docSection = docContent
    ? `## Product Documentation\n${docContent.slice(0, 3000)}${docContent.length > 3000 ? '\n…(truncated)' : ''}`
    : '## Product Documentation\nNone provided — without docs, never answer "app_bug"; use "test_bug" or "ambiguous".';

  const blocks = clusters.map((c, i) => {
    const rep = c.representative;
    const snippet = fileContent(rep.failure.file).slice(0, 1500);
    return `### Cluster ${i}  (${c.items.length} test(s) share this failure)
Representative test: "${rep.failure.title}"  [${rep.failure.file}]
Error:
${rep.failure.error.slice(0, 500)}

Test file excerpt:
\`\`\`typescript
${snippet}
\`\`\``;
  }).join('\n\n');

  const prompt = `You are a senior QA engineer triaging Playwright failures. Failures are pre-grouped into clusters that share one root cause — classify each CLUSTER once.

${docSection}

## Application URL
${appUrl}

## Clusters
${blocks}

## Verdicts
- test_bug    — the test code is wrong (bad selector, wrong URL/expected value, too-short wait). App behaviour is fine.
- app_bug     — the test is correct and matches a DOCUMENTED feature, but the app doesn't deliver it. Only with explicit doc support.
- setup_error — login/auth/environment/fixture problem; the test never reached its real assertions.
- ambiguous   — genuinely cannot tell.

Respond with ONLY valid JSON, keyed by the integer cluster id:
{"clusters":[{"id":0,"verdict":"test_bug","reasoning":"<one sentence>"}]}`;

  onProgress?.(`  LLM triage for ${clusters.length} unclear cluster(s)…`);

  let parsed: { clusters?: { id: number; verdict: string; reasoning: string }[] } = {};
  try {
    const raw = await model.invoke(
      [
        { role: 'system', content: 'You are a test-failure analyst. Respond with valid JSON only — no markdown, no prose.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 4_096 },
    );
    parsed = JSON.parse(raw.replace(/```(?:json)?\n?/g, '').trim());
  } catch (err) {
    // Keep the deterministic rule verdicts — do NOT blanket everything to ambiguous.
    onProgress?.(`  ⚠ LLM triage parse failed (${err instanceof Error ? err.message : String(err)}); keeping rule-based verdicts.`);
    return;
  }

  for (const r of parsed.clusters ?? []) {
    const c = clusters[r.id];
    if (!c) continue;
    const v: FailureVerdict =
      r.verdict === 'app_bug' ? 'app_bug'
      : r.verdict === 'setup_error' ? 'setup_error'
      : r.verdict === 'test_bug' ? 'test_bug'
      : r.verdict === 'ambiguous' ? 'ambiguous'
      : c.verdict; // unknown string → keep rule verdict
    c.verdict = v;
    c.reasoning = r.reasoning?.slice(0, 240) || c.reasoning;
    c.confidence = 'medium'; // LLM-decided
    for (const it of c.items) { it.rule.verdict = v; it.rule.reasoning = c.reasoning; }
  }
}

// ── Cluster summaries (human root-cause text) ────────────────────────────────────

function summarize(c: Cluster): string {
  const n = c.items.length;
  const where = c.files.size === 1 ? ` in ${[...c.files][0].split('/').pop()}` : ` across ${c.files.size} files`;
  const plural = n === 1 ? 'test' : 'tests';
  switch (c.signature.split('|')[0]) {
    case 'setup':      return `${n} ${plural} blocked: login/setup failed — fix credentials or login selectors.`;
    case 'navigation': return `${n} ${plural} blocked: the application could not be reached.`;
    case 'selector-missing': return `${n} ${plural}${where}: a selector matched no elements (broken/stale locator).`;
    case 'visible':    return `${n} ${plural}${where}: an element expected to be visible was missing.`;
    case 'url':        return `${n} ${plural}${where}: navigation did not reach the expected URL.`;
    case 'timeout':    return `${n} ${plural}${where}: timed out before completing.`;
    default:           return `${n} ${plural}${where}: ${c.reasoning}`;
  }
}

// ── Public function ───────────────────────────────────────────────────────────────

export async function triageFailures(
  workspace: Workspace,
  docContent: string | null,
  appUrl: string,
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<TriageResult> {
  const empty: TriageResult = {
    analyses: [], testBugCount: 0, appBugCount: 0, ambiguousCount: 0,
    setupErrorCount: 0, clusters: [], selfHealRecommended: false, triageAt: Date.now(),
  };

  const reportPath = path.join(workspace.dir, 'reports', 'report.json');
  if (!existsSync(reportPath)) {
    onProgress?.('Triage: no report found, skipping.');
    return empty;
  }

  let report: { suites?: Parameters<typeof collectFailures>[0][] };
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    return empty;
  }

  const fileFailures = (report.suites ?? []).flatMap(s => collectFailures(s)).filter(f => f.failures.length > 0);
  const flat = fileFailures.flatMap(f => f.failures);
  if (flat.length === 0) return empty;

  const hasDoc = !!docContent && docContent.trim().length > 0;

  // Stage 1 — deterministic classification of every failure.
  const items: WorkItem[] = flat.map(failure => {
    const signal = parseError(failure.error);
    return { failure, signal, rule: classify(signal, hasDoc) };
  });

  // Cluster by signature.
  const clusters = buildClusters(items);
  onProgress?.(`Triaging ${flat.length} failure(s) in ${clusters.length} cluster(s)…`);

  // Stage 2 — escalate only the clusters the rules couldn't resolve confidently.
  const contentCache = new Map<string, string>();
  const fileContent = (rel: string): string => {
    if (contentCache.has(rel)) return contentCache.get(rel)!;
    const abs = path.join(workspace.dir, rel);
    const c = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    contentCache.set(rel, c);
    return c;
  };
  const unclear = clusters.filter(c => c.confidence !== 'high');
  if (unclear.length > 0) {
    try {
      await classifyClustersWithLLM(unclear, fileContent, docContent, appUrl, model, onProgress);
    } catch (err) {
      onProgress?.(`  ⚠ LLM triage failed: ${err instanceof Error ? err.message : String(err)} — keeping rule verdicts.`);
    }
  }

  // Build the per-test analyses + cluster summaries.
  const outClusters: TriageCluster[] = clusters.map(c => ({
    id: c.id,
    signature: c.signature,
    verdict: c.verdict,
    count: c.items.length,
    summary: summarize(c),
    testNames: c.items.map(it => it.failure.title),
    file: c.files.size === 1 ? [...c.files][0] : undefined,
  }));

  const analyses: FailureAnalysis[] = clusters.flatMap(c =>
    c.items.map(it => ({
      testName: it.failure.title,
      file: it.failure.file,
      error: it.failure.error,
      verdict: c.verdict,
      reasoning: it.rule.reasoning,
      confidence: c.confidence,
      source: (c.confidence === 'high' ? 'rule' : 'llm') as 'rule' | 'llm',
      clusterId: c.id,
    })),
  );

  const testBugCount   = analyses.filter(a => a.verdict === 'test_bug').length;
  const appBugCount    = analyses.filter(a => a.verdict === 'app_bug').length;
  const ambiguousCount = analyses.filter(a => a.verdict === 'ambiguous').length;
  const setupErrorCount = analyses.filter(a => a.verdict === 'setup_error').length;

  // A single setup/auth root cause that accounts for most failures dominates —
  // healing test bodies is pointless until login/env is fixed.
  const setupCluster = outClusters.find(c => c.verdict === 'setup_error');
  const dominantSetup = setupCluster && setupCluster.count >= Math.max(3, flat.length * 0.5);
  const dominantRootCause = dominantSetup
    ? setupCluster!.summary
    : (outClusters[0] && outClusters[0].count >= flat.length * 0.6 ? outClusters[0].summary : undefined);

  const selfHealRecommended = !dominantSetup && (testBugCount > 0 || ambiguousCount > 0);

  const parts = [
    testBugCount   > 0 ? `${testBugCount} test bug(s)` : '',
    appBugCount    > 0 ? `${appBugCount} app bug(s)` : '',
    setupErrorCount > 0 ? `${setupErrorCount} setup error(s)` : '',
    ambiguousCount > 0 ? `${ambiguousCount} ambiguous` : '',
  ].filter(Boolean).join(', ');
  onProgress?.(`Triage complete — ${parts || 'no failures classified'}.`);
  if (dominantRootCause) onProgress?.(`▶ Root cause: ${dominantRootCause}`);

  return {
    analyses,
    testBugCount, appBugCount, ambiguousCount, setupErrorCount,
    clusters: outClusters,
    selfHealRecommended,
    dominantRootCause,
    triageAt: Date.now(),
  };
}
