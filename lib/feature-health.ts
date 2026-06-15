/**
 * Feature health (Phase 3) — per-feature coverage & quality, rolled up from the
 * run history. Answers "Checkout 94%, Search flaky, Investors untested."
 *
 * Mapping tests → features: until featureId is populated on each test (Phase 4),
 * we bridge by FUNCTIONAL AREA — every feature has an `area`, and every test case
 * is labelled with an `area` (app-testcases). A feature's tests are the cases that
 * share its area. This is approximate (features sharing an area share stats) but
 * needs no extra data; Phase 4's featureId tagging makes it exact.
 */
import { prisma } from '@/lib/prisma';
import { getAppProfile, hostOf, bestFeatureId, type Criticality } from '@/lib/app-profile';
import { getAppTestCases } from '@/lib/app-testcases';

export interface FeatureHealth {
  id: string;
  name: string;
  area: string | null;
  criticality: Criticality;
  testCount: number;          // tests mapped to this feature
  passRate: number | null;    // 0–100 from the latest status of each test, or null when untested/unrun
  flaky: number;              // # of its tests that both passed and failed across history
  untested: boolean;          // no tests map to this feature
  trend: number[];            // recent per-run pass rates (oldest→newest), for a sparkline
  tests: string[];            // the test titles that verify this feature (traceability #9)
  quarantined: boolean;       // excluded from the gate + critical counts (#8)
}

export interface FeatureHealthReport {
  host: string;
  features: FeatureHealth[];
  totalFeatures: number;
  untestedCount: number;
  criticalUntested: number;   // untested AND criticality === 'critical' (the urgent gaps)
  criticalFailing: number;    // critical features with a tested-but-below-100% pass rate (#7)
}

const MAX_RUNS = 200;

export async function getFeatureHealth(orgId: string, host: string): Promise<FeatureHealthReport> {
  const empty: FeatureHealthReport = { host, features: [], totalFeatures: 0, untestedCount: 0, criticalUntested: 0, criticalFailing: 0 };

  const profile = await getAppProfile(orgId, host).catch(() => null);
  if (!profile || profile.features.length === 0) return empty;

  // Tests + their functional area, aggregated across this app's sessions.
  const tc = await getAppTestCases(orgId, host).catch(() => null);
  const cases = tc?.cases ?? [];

  // Per-test pass/fail history + latest status, keyed by test TITLE.
  const sessions = await prisma.session.findMany({ where: { orgId }, select: { id: true, url: true } });
  const sessionIds = sessions.filter(s => hostOf(s.url) === host).map(s => s.id);
  const rows = sessionIds.length
    ? await prisma.testRun.findMany({
        where: { sessionId: { in: sessionIds } },
        orderBy: { startedAt: 'asc' }, take: MAX_RUNS,
        select: { caseResults: true },
      })
    : [];

  const titleOf = (key: string) => (key.split(' › ').pop() ?? key).trim().toLowerCase();
  type Stat = { passed: number; failed: number; latest: 'passed' | 'failed' | 'skipped' | null };
  const stat = new Map<string, Stat>();
  // Also keep each run's per-title pass/fail (chronological) for the trend series.
  const runMaps: Map<string, 'passed' | 'failed'>[] = [];
  for (const r of rows) { // ascending → the last write wins as "latest"
    const cr = (r.caseResults ?? null) as Record<string, string> | null;
    if (!cr) continue;
    const runMap = new Map<string, 'passed' | 'failed'>();
    for (const [key, status] of Object.entries(cr)) {
      const t = titleOf(key);
      const e = stat.get(t) ?? { passed: 0, failed: 0, latest: null };
      if (status === 'passed') e.passed++;
      else if (status === 'failed') e.failed++;
      if (status === 'passed' || status === 'failed' || status === 'skipped') e.latest = status;
      stat.set(t, e);
      if (status === 'passed' || status === 'failed') runMap.set(t, status);
    }
    runMaps.push(runMap);
  }

  const TREND_RUNS = 12;

  // Assign each test to its single best-matching feature (token overlap, not just
  // area equality) — fixes the "untested" under-count and avoids shared stats.
  const featuresLite = profile.features.map(f => ({ id: f.id, name: f.name, area: f.area }));
  // Keep ORIGINAL-case titles per feature (for traceability + grep); look up
  // run stats with a lowercased key (stat/runMaps are lowercased).
  const titlesByFeature = new Map<string, string[]>();
  for (const c of cases) {
    const fid = bestFeatureId(featuresLite, { title: c.title, area: c.area });
    if (!fid) continue;
    const arr = titlesByFeature.get(fid) ?? [];
    arr.push(c.title.trim());
    titlesByFeature.set(fid, arr);
  }

  const features: FeatureHealth[] = profile.features.map(f => {
    const titles = titlesByFeature.get(f.id) ?? [];
    let passed = 0, rated = 0, flaky = 0;
    for (const t of titles) {
      const s = stat.get(t.toLowerCase());
      if (!s) continue;
      if (s.passed > 0 && s.failed > 0) flaky++;
      if (s.latest === 'passed') { passed++; rated++; }
      else if (s.latest === 'failed') { rated++; }
    }
    // Per-run pass rate for this feature's tests → recent trend (oldest→newest).
    const trend: number[] = [];
    for (const rm of runMaps) {
      let p = 0, tot = 0;
      for (const t of titles) {
        const st = rm.get(t.toLowerCase());
        if (st === 'passed') { p++; tot++; } else if (st === 'failed') { tot++; }
      }
      if (tot > 0) trend.push(Math.round((p / tot) * 100));
    }
    return {
      id: f.id, name: f.name, area: f.area, criticality: f.criticality,
      testCount: titles.length,
      passRate: rated > 0 ? Math.round((passed / rated) * 100) : null,
      flaky,
      untested: titles.length === 0,
      trend: trend.slice(-TREND_RUNS),
      tests: [...new Set(titles)].slice(0, 50),
      quarantined: f.quarantined,
    };
  });

  return {
    host,
    features,
    totalFeatures: features.length,
    untestedCount: features.filter(f => f.untested && !f.quarantined).length,
    criticalUntested: features.filter(f => f.untested && f.criticality === 'critical' && !f.quarantined).length,
    criticalFailing: features.filter(f => f.criticality === 'critical' && !f.quarantined && f.passRate != null && f.passRate < 100).length,
  };
}
