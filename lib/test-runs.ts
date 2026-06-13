/**
 * TestRun history — append-only record of every test execution.
 *
 * Session.testResult keeps only the LATEST result (UI compatibility); these
 * rows are the durable history that enables pass-rate trends, flaky-test
 * detection, and per-run forensics. All writes are best-effort: a history
 * failure must never break a live run.
 */
import { prisma } from '@/lib/prisma';
import type { TestResult, TriageResult, FixResult } from '@/types/session';

export type RunTrigger = 'loop' | 'manual' | 'single-file' | 'scenario';

const OUTPUT_TAIL_CHARS = 8_000;

export interface RecordTestRunOptions {
  trigger: RunTrigger;
  iteration?: number;
  targetFile?: string;
}

/** Append one execution to the history. Returns the run id (or null on failure). */
export async function recordTestRun(
  sessionId: string,
  result: TestResult,
  opts: RecordTestRunOptions,
): Promise<string | null> {
  try {
    const { stats } = result;
    const status =
      stats.errors > 0 && stats.total === 0 ? 'error'
      : stats.failed > 0 || stats.errors > 0 ? 'failed'
      : 'passed';

    const run = await prisma.testRun.create({
      data: {
        sessionId,
        trigger:    opts.trigger,
        iteration:  opts.iteration ?? 0,
        targetFile: opts.targetFile ?? null,
        status,
        durationMs: Math.round((result.duration ?? 0) * 1000),
        total:  stats.total,
        passed: stats.passed,
        failed: stats.failed,
        errors: stats.errors,
        caseResults: result.cases ?? undefined,
        output: result.output ? result.output.slice(-OUTPUT_TAIL_CHARS) : undefined,
        videos: result.videos?.length ? result.videos : undefined,
      },
      select: { id: true },
    });
    return run.id;
  } catch {
    return null; // history is best-effort
  }
}

/**
 * Merge a single-file run (scenario / run-file) into the previous suite-wide
 * result so the headline numbers are CUMULATIVE (old + new) instead of being
 * clobbered by the one file that just ran.
 *
 * Strategy: per-case merge. Cases from the just-run file replace that file's
 * previous entries; everything else is kept. Stats are recomputed from the
 * merged case map. Falls back to the new result alone when the previous one
 * has no case data (pre-history runs).
 */
export function mergeTestResult(
  prev: TestResult | null,
  next: TestResult,
  targetFile: string,
): TestResult {
  if (!prev?.cases || Object.keys(prev.cases).length === 0) return next;

  const merged: Record<string, 'passed' | 'failed' | 'skipped'> = {};
  const base = targetFile.split('/').pop() ?? targetFile;
  for (const [key, status] of Object.entries(prev.cases)) {
    // Drop the old entries belonging to the file that just re-ran.
    if (key.split(' › ')[0]?.endsWith(base)) continue;
    merged[key] = status;
  }
  for (const [key, status] of Object.entries(next.cases ?? {})) merged[key] = status;

  let passed = 0, failed = 0, skipped = 0;
  for (const s of Object.values(merged)) {
    if (s === 'passed') passed++;
    else if (s === 'failed') failed++;
    else skipped++;
  }

  return {
    code: next.code,
    duration: next.duration,           // duration of the latest run
    stats: { total: passed + failed + skipped, passed, failed, errors: next.stats.errors },
    output: next.output,
    videos: [...new Set([...(prev.videos ?? []), ...(next.videos ?? [])])],
    cases: merged,
  };
}

/** Attach the triage verdicts produced for a run (best-effort). */
export async function attachTriageToRun(runId: string | null, triage: TriageResult): Promise<void> {
  if (!runId) return;
  try {
    await prisma.testRun.update({
      where: { id: runId },
      data: { triage: triage as unknown as object },
    });
  } catch { /* best-effort */ }
}

/** Attach the self-heal fix applied after a run (best-effort). */
export async function attachFixToRun(runId: string | null, fix: FixResult): Promise<void> {
  if (!runId) return;
  try {
    await prisma.testRun.update({
      where: { id: runId },
      data: { fix: fix as unknown as object },
    });
  } catch { /* best-effort */ }
}
