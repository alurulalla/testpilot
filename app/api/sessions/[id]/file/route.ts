/**
 * GET /api/sessions/[id]/file?path=tests/homepage.spec.ts
 *
 * Returns the content of one workspace file. Reads from the durable DB copy
 * (SessionFile) first — so "View code" works even on a cold container where the
 * disk was wiped — and falls back to disk for anything not snapshotted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { requireSessionAccess } from '@/lib/session-access';
import { prisma } from '@/lib/prisma';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;

  const rel = (req.nextUrl.searchParams.get('path') ?? '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  // 1) durable DB copy
  try {
    const row = await prisma.sessionFile.findUnique({
      where: { sessionId_path: { sessionId: id, path: rel } },
      select: { content: true, deletedAt: true },
    });
    if (row && !row.deletedAt) {
      return new NextResponse(row.content, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  } catch { /* fall through to disk */ }

  // 2) disk fallback
  try {
    const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(id, session.orgId) });
    const full = path.join(workspace.dir, rel);
    if (existsSync(full)) {
      return new NextResponse(readFileSync(full, 'utf8'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  } catch { /* not found */ }

  return NextResponse.json({ error: 'file not found' }, { status: 404 });
}
