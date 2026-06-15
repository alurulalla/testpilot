/**
 * POST /api/app-profile/run-critical  { host }  — critical-first "smoke" run (#5).
 *
 * Runs ONLY the tests that verify CRITICAL features (via the traceability map),
 * for fast feedback on what matters most. Backgrounded (tests take minutes) and
 * recorded as a TestRun so feature-health/trends pick it up. Streams to the
 * session log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hostOf } from '@/lib/app-profile';
import { getFeatureHealth } from '@/lib/feature-health';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';
import { ensureWorkspaceReady } from '@/lib/session-files';
import { addLog } from '@/lib/session-store';
import { runTestsAsync, escapeRegExp } from '@/lib/run-tests-async';
import { recordTestRun } from '@/lib/test-runs';

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string; featureId?: string };
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    const host = body.host;

    // #6 change-impact: a specific feature when featureId is given; otherwise the
    // critical-first smoke set (#5).
    const health = await getFeatureHealth(org.id, host);
    const selected = body.featureId
      ? health.features.filter(f => f.id === body.featureId)
      : health.features.filter(f => f.criticality === 'critical');
    const scope = body.featureId ? (selected[0]?.name ?? 'feature') : 'critical features';
    const titles = [...new Set(selected.flatMap(f => f.tests))];
    if (titles.length === 0) {
      return NextResponse.json({ error: `No tests cover ${scope} yet — generate some first.` }, { status: 409 });
    }

    const sessions = await prisma.session.findMany({
      where: { orgId: org.id }, orderBy: { updatedAt: 'desc' }, select: { id: true, url: true },
    });
    const src = sessions.find(s => hostOf(s.url) === host);
    if (!src) return NextResponse.json({ error: 'No session for this app.' }, { status: 409 });

    const workspace = new Workspace({ url: src.url, rootDir: getSessionDir(src.id, org.id) });

    // Run in the background — tests take minutes; stream to the session log.
    void (async () => {
      try {
        await ensureWorkspaceReady(src.id, workspace);
        addLog(src.id, `🔬 Smoke run (${scope}): ${titles.length} test(s)…`, 'info');
        const grepRegex = `(${titles.map(escapeRegExp).join('|')})`;
        const result = await runTestsAsync(workspace, line => addLog(src.id, line, 'info'), src.id, false, undefined, grepRegex);
        await recordTestRun(src.id, result, { trigger: 'smoke' });
        addLog(src.id, `🔬 Smoke run (${scope}) complete: ${result.stats.passed}/${result.stats.total} passed, ${result.stats.failed} failed.`,
          result.stats.failed ? 'error' : 'success');
      } catch (e) {
        addLog(src.id, `Critical smoke run failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    })();

    return NextResponse.json({ ok: true, sessionId: src.id, ran: titles.length });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
