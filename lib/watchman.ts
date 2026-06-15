/**
 * Watchman (E4) — the scheduled health pass.
 *
 * Runs on a cron (see app/api/cron/watchman + docs/watchman-cron.md). For every
 * app that has a profile it recomputes feature health and surfaces the things a
 * human would want flagged between manual runs: critical coverage gaps, flaky
 * features, and features below a pass-rate threshold.
 *
 * SAFE BY DESIGN: this pass reads + reports only — it does NOT re-run test suites
 * (that costs tokens/compute and needs a cadence decision). Auto-rerun is left as
 * an explicit opt-in hook (WATCHMAN_AUTORUN) the team can wire when ready.
 */
import { prisma } from '@/lib/prisma';
import { getFeatureHealth } from '@/lib/feature-health';

const LOW_PASS_THRESHOLD = 80;

export interface WatchmanAppReport {
  orgId: string;
  host: string;
  totalFeatures: number;
  untested: number;
  criticalUntested: number;
  flakyFeatures: string[];
  lowFeatures: { name: string; passRate: number }[];
}

/** One health pass over every app that has a profile. Read-only. */
export async function runWatchman(onLog?: (line: string) => void): Promise<WatchmanAppReport[]> {
  const profiles = await prisma.appProfile.findMany({ select: { orgId: true, host: true } }).catch(() => []);
  const reports: WatchmanAppReport[] = [];

  for (const { orgId, host } of profiles) {
    const h = await getFeatureHealth(orgId, host).catch(() => null);
    if (!h) continue;

    const flakyFeatures = h.features.filter(f => f.flaky > 0).map(f => f.name);
    const lowFeatures = h.features
      .filter(f => f.passRate != null && f.passRate < LOW_PASS_THRESHOLD)
      .map(f => ({ name: f.name, passRate: f.passRate as number }));

    reports.push({
      orgId, host,
      totalFeatures: h.totalFeatures,
      untested: h.untestedCount,
      criticalUntested: h.criticalUntested,
      flakyFeatures,
      lowFeatures,
    });

    onLog?.(
      `[watchman] ${host}: ${h.totalFeatures} features · ${h.untestedCount} untested ` +
      `(${h.criticalUntested} critical) · ${h.criticalFailing} critical failing · ${flakyFeatures.length} flaky · ${lowFeatures.length} below ${LOW_PASS_THRESHOLD}%`,
    );
  }

  onLog?.(`[watchman] pass complete — ${reports.length} app(s) checked`);
  return reports;
}
