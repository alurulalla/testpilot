/**
 * GET /api/trends?host=<hostname>
 * Pass-rate-over-time + flaky-test trends for one app, aggregated from the
 * append-only TestRun history of every session the org has for that app.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getAppTrends } from '@/lib/app-trends';

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    return NextResponse.json(await getAppTrends(org.id, host));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
