/**
 * GET /api/triage-summary?host=<hostname>
 * Aggregate triage verdicts across an app's sessions — how many test bugs (and
 * app bugs / setup errors / ambiguous) have been identified. Org-scoped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hostOf } from '@/lib/app-profile';

interface TriageCounts { testBugCount?: number; appBugCount?: number; setupErrorCount?: number; ambiguousCount?: number }

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

    const sessions = await prisma.session.findMany({
      where: { orgId: org.id },
      select: { url: true, triageResult: true },
    });

    let testBugs = 0, appBugs = 0, setupErrors = 0, ambiguous = 0;
    for (const s of sessions) {
      if (hostOf(s.url) !== host) continue;
      const t = (s.triageResult ?? null) as TriageCounts | null;
      if (!t) continue;
      testBugs += t.testBugCount ?? 0;
      appBugs += t.appBugCount ?? 0;
      setupErrors += t.setupErrorCount ?? 0;
      ambiguous += t.ambiguousCount ?? 0;
    }

    return NextResponse.json({ testBugs, appBugs, setupErrors, ambiguous });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
