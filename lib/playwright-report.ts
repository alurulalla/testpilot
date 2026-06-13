/**
 * Shared parser for Playwright's JSON report (reports/report.json).
 *
 * Used by every runner (full suite, single file, scenario) so stats AND
 * per-test-case outcomes are extracted consistently. Case results feed the
 * TestRun history table (flaky-test detection, per-test trends).
 */
import { existsSync, readFileSync } from 'fs';
import type { TestStats } from '@/types/session';

/** "<file> › <test title>" → outcome */
export type CaseResults = Record<string, 'passed' | 'failed' | 'skipped'>;

interface ReportSpec {
  title?: string;
  ok?: boolean;
  file?: string;
  tests?: Array<{ status?: string; results?: Array<{ status?: string }> }>;
}
interface ReportSuite {
  title?: string;
  file?: string;
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}
interface PlaywrightReport {
  suites?: ReportSuite[];
  errors?: unknown[];
  stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
}

export interface ParsedReport {
  stats: TestStats;
  cases: CaseResults;
}

// ── Error-message extraction ───────────────────────────────────────────────
// Playwright's JSON report is inconsistent about where a failure's message
// lives: sometimes `results[i].error.message`, sometimes only the `errors[]`
// array, sometimes the real detail is in `error.value`/`error.stack`, and for
// crashes/timeouts/fixture failures it's only in captured stderr/stdout. Older
// code read just `results[0].error.message ?? .value` and fell back to the
// useless literal "Unknown error". This walks all of those sources.

interface PwError { message?: string; value?: string; stack?: string }
interface PwResult {
  status?: string;
  error?: PwError;
  errors?: PwError[];
  stdout?: Array<{ text?: string } | string>;
  stderr?: Array<{ text?: string } | string>;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function oneError(e: PwError | undefined): string {
  if (!e) return '';
  // Prefer message; fall back to value, then the first useful line of the stack.
  return (e.message || e.value || (e.stack ? e.stack.split('\n')[0] : '') || '').trim();
}

function streamText(stream: PwResult['stdout']): string {
  if (!stream) return '';
  return stream
    .map(c => (typeof c === 'string' ? c : c?.text ?? ''))
    .join('')
    .trim();
}

/**
 * Best-effort human-readable error for a failed test. Returns '' only when the
 * report truly carries no signal at all (caller decides the placeholder).
 */
export function extractTestError(results: PwResult[] | undefined): string {
  if (!results || results.length === 0) return '';

  // Walk results newest→oldest (final retry has the authoritative failure).
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    const fromArray = (r.errors ?? []).map(oneError).filter(Boolean).join('\n');
    const text = oneError(r.error) || fromArray;
    if (text) return stripAnsi(text).slice(0, 600);
  }
  // No structured error → a thrown fixture error or crash usually lands in stderr.
  for (let i = results.length - 1; i >= 0; i--) {
    const err = streamText(results[i].stderr) || streamText(results[i].stdout);
    if (err) return stripAnsi(err).slice(-600);
  }
  return '';
}

/** Human-friendly default when even stderr is empty (worker crash / timeout). */
export const NO_ERROR_DETAIL =
  'Test failed but Playwright captured no error text — usually a worker crash, a global timeout, or a failure in the login/setup fixture before the test body ran.';

function walkSuites(suites: ReportSuite[] | undefined, fileHint: string, cases: CaseResults): void {
  for (const suite of suites ?? []) {
    const file = suite.file ?? fileHint;
    for (const spec of suite.specs ?? []) {
      const key = `${spec.file ?? file} › ${spec.title ?? '(untitled)'}`;
      // spec.ok reflects the final outcome incl. retries.
      const anySkipped = spec.tests?.some(t =>
        (t.results?.every(r => r.status === 'skipped') ?? false) || t.status === 'skipped',
      );
      cases[key] = spec.ok ? 'passed' : anySkipped ? 'skipped' : 'failed';
    }
    walkSuites(suite.suites, file, cases);
  }
}

/** Parse the JSON report; returns zeroed stats + empty cases when unreadable. */
export function parsePlaywrightReport(reportPath: string): ParsedReport {
  const empty: ParsedReport = {
    stats: { total: 0, passed: 0, failed: 0, errors: 0 },
    cases: {},
  };
  try {
    if (!existsSync(reportPath)) return empty;
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport;

    // A report with top-level errors and no suites = the run itself broke
    // (syntax error, no tests found) rather than tests failing.
    if ((report.errors?.length ?? 0) > 0 && (report.suites?.length ?? 0) === 0) {
      return { stats: { total: 0, passed: 0, failed: 0, errors: report.errors!.length }, cases: {} };
    }

    const s = report.stats ?? {};
    const passed  = (s.expected ?? 0) + (s.flaky ?? 0);
    const failed  = s.unexpected ?? 0;
    const skipped = s.skipped ?? 0;

    const cases: CaseResults = {};
    walkSuites(report.suites, '', cases);

    return {
      stats: { total: passed + failed + skipped, passed, failed, errors: 0 },
      cases,
    };
  } catch {
    return { ...empty, stats: { ...empty.stats, errors: 1 } };
  }
}
