/**
 * GET /api/cron/feature-gate?host=<hostname>  — CI deploy gate (#10).
 *
 * Machine-to-machine (Bearer CRON_SECRET, like the watchman). Returns HTTP 200
 * when the app is safe to ship — no CRITICAL feature is untested or failing — and
 * HTTP 412 (with the blocking features) otherwise, so a CI step using `curl -f`
 * fails the build. Derived entirely from the feature-health rollup.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getFeatureHealth } from '@/lib/feature-health';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const provided = bearer || req.nextUrl.searchParams.get('key') || '';
  if (provided !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const host = req.nextUrl.searchParams.get('host');
  if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

  // Gate is org-scoped by host: find any org that has a profile for this host.
  const profile = await prisma.appProfile.findFirst({ where: { host }, select: { orgId: true } });
  if (!profile) return NextResponse.json({ error: 'No profile for this host' }, { status: 404 });

  const h = await getFeatureHealth(profile.orgId, host);
  const blocking = h.features
    .filter(f => f.criticality === 'critical' && !f.quarantined && (f.untested || (f.passRate != null && f.passRate < 100)))
    .map(f => ({ name: f.name, reason: f.untested ? 'untested' : `pass rate ${f.passRate}%` }));

  const ok = blocking.length === 0;
  return NextResponse.json(
    { ok, host, criticalUntested: h.criticalUntested, criticalFailing: h.criticalFailing, blocking },
    { status: ok ? 200 : 412 },
  );
}

export const GET = handle;
export const POST = handle;
