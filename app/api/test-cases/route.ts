/**
 * GET /api/test-cases?host=<hostname>
 * The tests TestPilot has identified/generated/added across every session for
 * one app, with per-test coverage (how many sessions contain it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getAppTestCases } from '@/lib/app-testcases';

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    return NextResponse.json(await getAppTestCases(org.id, host));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
