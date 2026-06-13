import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { rmSync } from 'fs';
import { getSession, updateSession, deleteSession } from '@/lib/session-store';
import { requireOrgAdmin, authErrorResponse } from '@/lib/auth';
import { getSessionDir } from '@/lib/config';

const ACTIVE_STATUSES = ['exploring', 'analyzing', 'generating', 'running', 'fixing', 'figma-checking'];


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(session);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { headedMode?: boolean };
  if (typeof body.headedMode === 'boolean') {
    updateSession(id, { headedMode: body.headedMode });
    return NextResponse.json({ ...session, headedMode: body.headedMode });
  }

  return NextResponse.json(session);
}

/**
 * DELETE /api/sessions/[id] — remove a session. Org-admin only.
 * Refuses to delete a session that is currently running (must be stopped first).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let org;
  try {
    ({ org } = await requireOrgAdmin());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Scope to the admin's own organisation.
  if (session.orgId !== org.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Never delete a running session.
  if (ACTIVE_STATUSES.includes(session.status) || session.figmaChecking) {
    return NextResponse.json(
      { error: 'This session is still running. Stop it before deleting.' },
      { status: 409 },
    );
  }

  await deleteSession(id);
  // Best-effort: remove the on-disk workspace for this session.
  try { rmSync(getSessionDir(id, org.id), { recursive: true, force: true }); } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
