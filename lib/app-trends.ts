/**
 * App trends — aggregates the append-only TestRun history for every session of
 * one app (org + hostname) into pass-rate-over-time and flaky-test signals.
 *
 * This is the analytics counterpart to the dashboard's "current status" view:
 * the dashboard shows each session's LATEST result, while this walks the whole
 * run history (every execution) to surface trends and flakiness.
 */
import { prisma } from '@/lib/prisma';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export interface TrendRun {
  t: number;                 // startedAt (ms)
  passed: number;
  failed: number;
  errors: number;
  total: number;
  rate: number | null;       // 0–100, null when the run had no tests
  durationMs: number | null;
  trigger: string;
}

export interface FlakyTest {
  name: string;              // "<file> › <title>"
  passed: number;
  failed: number;
  runs: number;
}

export interface AppTrends {
  host: string;
  totalRuns: number;
  sessionCount: number;
  runs: TrendRun[];          // chronological (oldest → newest)
  flaky: FlakyTest[];        // most flaky first
  avgDurationMs: number | null;
  firstRate: number | null;
  lastRate: number | null;
}

const MAX_RUNS = 200;

export async function getAppTrends(orgId: string, host: string): Promise<AppTrends> {
  const empty: AppTrends = {
    host, totalRuns: 0, sessionCount: 0, runs: [], flaky: [],
    avgDurationMs: null, firstRate: null, lastRate: null,
  };

  // Sessions of this org that belong to the requested app (by hostname).
  const sessions = await prisma.session.findMany({
    where: { orgId },
    select: { id: true, url: true },
  });
  const sessionIds = sessions.filter(s => hostOf(s.url) === host).map(s => s.id);
  if (sessionIds.length === 0) return empty;

  const rows = await prisma.testRun.findMany({
    where: { sessionId: { in: sessionIds } },
    orderBy: { startedAt: 'asc' },
    take: MAX_RUNS,
    select: {
      startedAt: true, durationMs: true, trigger: true,
      total: true, passed: true, failed: true, errors: true,
      caseResults: true,
    },
  });
  if (rows.length === 0) return { ...empty, sessionCount: sessionIds.length };

  const runs: TrendRun[] = rows.map(r => {
    const total = r.total ?? 0;
    return {
      t: r.startedAt.getTime(),
      passed: r.passed ?? 0,
      failed: r.failed ?? 0,
      errors: r.errors ?? 0,
      total,
      rate: total > 0 ? Math.round(((r.passed ?? 0) / total) * 100) : null,
      durationMs: r.durationMs ?? null,
      trigger: r.trigger,
    };
  });

  // Flaky detection: a test that has BOTH passed and failed across runs.
  const tally = new Map<string, { passed: number; failed: number }>();
  for (const r of rows) {
    const cases = (r.caseResults ?? null) as Record<string, string> | null;
    if (!cases) continue;
    for (const [name, status] of Object.entries(cases)) {
      if (status !== 'passed' && status !== 'failed') continue;
      const e = tally.get(name) ?? { passed: 0, failed: 0 };
      if (status === 'passed') e.passed++; else e.failed++;
      tally.set(name, e);
    }
  }
  const flaky: FlakyTest[] = [...tally.entries()]
    .filter(([, v]) => v.passed > 0 && v.failed > 0)
    .map(([name, v]) => ({ name, passed: v.passed, failed: v.failed, runs: v.passed + v.failed }))
    .sort((a, b) => Math.min(b.passed, b.failed) - Math.min(a.passed, a.failed) || b.runs - a.runs)
    .slice(0, 15);

  const durations = runs.map(r => r.durationMs).filter((d): d is number => d != null && d > 0);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  const rated = runs.filter(r => r.rate != null);
  return {
    host,
    totalRuns: rows.length,
    sessionCount: sessionIds.length,
    runs,
    flaky,
    avgDurationMs,
    firstRate: rated.length ? rated[0].rate : null,
    lastRate: rated.length ? rated[rated.length - 1].rate : null,
  };
}
