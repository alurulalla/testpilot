/**
 * GET  /api/sessions/[id]/flows  — return all user flows
 * POST /api/sessions/[id]/flows  — add a new flow
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSession, getCachedSession, addUserFlow } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { writeContextMd } from '@/lib/build-context-md';
import type { UserFlow } from '@/types/session';
import { getSessionDir } from '@/lib/config';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ flows: session.userFlows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    title?: string;
    description?: string;
    steps?: string[];
  };

  const title = body.title?.trim();
  const description = body.description?.trim();
  if (!title || !description) {
    return NextResponse.json({ error: 'title and description are required' }, { status: 400 });
  }

  const flow: UserFlow = {
    id: randomUUID(),
    title,
    description,
    steps: (body.steps ?? []).filter((s: string) => s.trim()),
    addedAt: Date.now(),
  };

  addUserFlow(id, flow);

  // Rebuild CONTEXT.md so the generator picks up the new flow
  const ws = new Workspace({ url: session.url, rootDir: getSessionDir(id, session.orgId) });
  writeContextMd(ws.dir, session.contextDoc, [...session.userFlows, flow]);

  return NextResponse.json({ ok: true, flow });
}
