/**
 * GET /api/sessions/[id]/logs?after=<cursor>
 *
 * Returns SessionLog rows for the given session written after the given cursor
 * (an integer string representing a SessionLog.id BigInt).  Clients use this
 * to catch up missed log entries after an SSE reconnect.
 *
 * cursor defaults to 0 (return all logs).
 * Responses are capped at 1 000 rows per call; paginate with the returned
 * `nextCursor` field.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const PAGE_SIZE = 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const afterParam = req.nextUrl.searchParams.get('after') ?? '0';
  let cursor: bigint;
  try {
    cursor = BigInt(afterParam);
  } catch {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  }

  const rows = await prisma.sessionLog.findMany({
    where: { sessionId: id, id: { gt: cursor } },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE,
  });

  const entries = rows.map(r => ({
    id:    r.id.toString(),   // BigInt → string (JSON-safe)
    ts:    r.createdAt.getTime(),
    msg:   r.message,
    level: r.level as 'info' | 'error' | 'success',
  }));

  const nextCursor =
    rows.length === PAGE_SIZE ? rows[rows.length - 1].id.toString() : null;

  return NextResponse.json({ entries, nextCursor });
}
