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
import { getAppProfile, hostOf, bestFeatureId, featureIntentHash, type Criticality } from '@/lib/app-profile';
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
  /** Visual-design baseline: how many Figma frames map to this feature, and the
   *  best (highest) pixel-match score across them — used by #14 (visual coverage
   *  gaps) and consumed by per-feature generation (#12) to decide whether to add
   *  a visual screenshot assertion. */
  visualBaselineCount: number;
  visualMatchScore: number | null;
  /** #13 — at least one of this feature's mapped Figma frames changed in the
   *  latest run. The visual baseline is stale relative to the new design. */
  visualDrifted: boolean;
  /** #1 — % of this feature's expected outcomes actually asserted by its tests
   *  (cached from the last analyze-intent run). null when never audited. */
  intentCoverage: number | null;
  /** #2 — number of tests mapped to this feature that assert nothing meaningful. */
  shallowTestCount: number;
  /** #5 — the feature's outcomes or its tests changed since the last intent audit;
   *  the cached intentCoverage % is stale. */
  intentDrifted: boolean;
}

export interface FeatureHealthReport {
  host: string;
  features: FeatureHealth[];
  totalFeatures: number;
  untestedCount: number;
  criticalUntested: number;   // untested AND criticality === 'critical' (the urgent gaps)
  criticalFailing: number;    // critical features with a tested-but-below-100% pass rate (#7)
  /** #14 — features without a visual baseline (no Figma frame mapped). */
  visualUntestedCount: number;
  /** #13 — features with a stale visual baseline (a mapped frame changed). */
  visualDriftedCount: number;
  /** #5 — features whose intent audit is stale (outcomes or tests changed). */
  intentDriftedCount: number;
  /** #2 — features with at least one shallow test (asserts nothing). */
  shallowTestFeatureCount: number;
}

const MAX_RUNS = 200;

export async function getFeatureHealth(orgId: string, host: string): Promise<FeatureHealthReport> {
  const empty: FeatureHealthReport = { host, features: [], totalFeatures: 0, untestedCount: 0, criticalUntested: 0, criticalFailing: 0, visualUntestedCount: 0, visualDriftedCount: 0, intentDriftedCount: 0, shallowTestFeatureCount: 0 };

  const profile = await getAppProfile(orgId, host).catch(() => null);
  if (!profile || profile.features.length === 0) return empty;

  // Tests + their functional area, aggregated across this app's sessions.
  const tc = await getAppTestCases(orgId, host).catch(() => null);
  const cases = tc?.cases ?? [];

  // Per-test pass/fail history + latest status, keyed by test TITLE.
  // Also pull figmaResult so we can fold visual baselines into the rollup (#14).
  const sessions = await prisma.session.findMany({
    where: { orgId },
    select: { id: true, url: true, figmaResult: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
  });
  const appSessions = sessions.filter(s => hostOf(s.url) === host);
  const sessionIds = appSessions.map(s => s.id);

  // Aggregate Figma comparisons across this app's sessions (later runs win).
  // designDrifted is taken from the LATEST figmaResult only — older runs are
  // historical; the current state is what matters for "is the baseline stale?".
  type Cmp = { featureId?: string; matchScore?: number; designDrifted?: boolean };
  const figByFeature = new Map<string, { count: number; maxScore: number | null; drifted: boolean }>();
  const latestWithFigma = [...appSessions].reverse().find(s => {
    const fr = (s.figmaResult ?? null) as { comparisons?: Cmp[] } | null;
    return (fr?.comparisons?.length ?? 0) > 0;
  });
  for (const s of appSessions) {
    const fr = (s.figmaResult ?? null) as { comparisons?: Cmp[] } | null;
    const isLatest = s === latestWithFigma;
    for (const c of fr?.comparisons ?? []) {
      if (!c.featureId) continue;
      const e = figByFeature.get(c.featureId) ?? { count: 0, maxScore: null, drifted: false };
      e.count++;
      if (typeof c.matchScore === 'number') {
        e.maxScore = e.maxScore == null ? c.matchScore : Math.max(e.maxScore, c.matchScore);
      }
      if (isLatest && c.designDrifted) e.drifted = true;
      figByFeature.set(c.featureId, e);
    }
  }
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
    // #5 — intent drift: live hash vs. stored hash from last analyze-intent run.
    const liveHash = featureIntentHash(f.expectedOutcomes, titles);
    const intentDrifted = f.intentHash != null && f.intentHash !== liveHash;
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
      visualBaselineCount: figByFeature.get(f.id)?.count ?? 0,
      visualMatchScore: figByFeature.get(f.id)?.maxScore ?? null,
      visualDrifted: figByFeature.get(f.id)?.drifted ?? false,
      intentCoverage: f.intentCoverage,
      shallowTestCount: f.shallowTestCount,
      intentDrifted,
    };
  });

  return {
    host,
    features,
    totalFeatures: features.length,
    untestedCount: features.filter(f => f.untested && !f.quarantined).length,
    criticalUntested: features.filter(f => f.untested && f.criticality === 'critical' && !f.quarantined).length,
    criticalFailing: features.filter(f => f.criticality === 'critical' && !f.quarantined && f.passRate != null && f.passRate < 100).length,
    visualUntestedCount: features.filter(f => !f.quarantined && f.visualBaselineCount === 0).length,
    visualDriftedCount: features.filter(f => !f.quarantined && f.visualDrifted).length,
    intentDriftedCount: features.filter(f => !f.quarantined && f.intentDrifted).length,
    shallowTestFeatureCount: features.filter(f => !f.quarantined && f.shallowTestCount > 0).length,
  };
}
