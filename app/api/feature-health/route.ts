/**
 * GET /api/feature-health?host=<hostname>
 * Per-feature coverage & quality (pass rate, flaky, untested) for one app,
 * derived from the App Profile features + the run history. Org-scoped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getFeatureHealth } from '@/lib/feature-health';

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    return NextResponse.json(await getFeatureHealth(org.id, host));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
