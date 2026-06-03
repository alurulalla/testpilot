/**
 * DELETE /api/sessions/[id]/flows/[flowId]  — remove a specific user flow
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getSession, removeUserFlow } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { writeContextMd } from '@/lib/build-context-md';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; flowId: string }> },
) {
  const { id, flowId } = await params;
  const session = getSessionOrRestore(id, req);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  removeUserFlow(id, flowId);

  // Rebuild CONTEXT.md without the removed flow
  const remaining = session.userFlows.filter(f => f.id !== flowId);
  const ws = new Workspace({ url: session.url, rootDir: getSessionDir(id) });
  writeContextMd(ws.dir, session.contextDoc, remaining);

  return NextResponse.json({ ok: true });
}
