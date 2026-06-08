import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/session-store';


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(session);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { headedMode?: boolean };
  if (typeof body.headedMode === 'boolean') {
    updateSession(id, { headedMode: body.headedMode });
  }

  return NextResponse.json(session);
}
