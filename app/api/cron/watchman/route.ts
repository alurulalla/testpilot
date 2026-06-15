/**
 * GET|POST /api/cron/watchman  — the scheduled health pass (E4).
 *
 * Protected by a shared secret (NOT user auth — this is machine-to-machine):
 *   Authorization: Bearer <CRON_SECRET>   (or ?key=<CRON_SECRET>)
 * Configure a Railway cron service to hit it; see docs/watchman-cron.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runWatchman } from '@/lib/watchman';

export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });

  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const provided = bearer || req.nextUrl.searchParams.get('key') || '';
  if (provided !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const reports = await runWatchman(line => console.log(line));
  return NextResponse.json({ ok: true, apps: reports.length, reports });
}

export const GET = handle;
export const POST = handle;
