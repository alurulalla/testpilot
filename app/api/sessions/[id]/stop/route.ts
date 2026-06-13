import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { getSession, setStatus, addLog, markStopping, killProcess } from '@/lib/session-store';


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  markStopping(id);
  killProcess(id);     // kills the playwright test runner process if running
  // Do NOT call setStatus here — the loop's stopped() helper sets 'idle' once
  // the current awaited operation finishes.  Setting it here races with the
  // loop re-setting it to 'running' / 'fixing' on its next iteration.
  addLog(id, 'Stop requested — waiting for current operation to finish…', 'info');

  return NextResponse.json({ stopped: true });
}
