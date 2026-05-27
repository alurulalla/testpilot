import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, addLog, markStopping, killProcess } from '@/lib/session-store';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  markStopping(id);
  killProcess(id);     // kills the playwright test runner process if running
  setStatus(id, 'idle');
  addLog(id, 'Stopped by user.', 'info');

  return NextResponse.json({ stopped: true });
}
