import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requestJobCancellation } from '@/lib/jobs/queue';

type Params = { params: Promise<{ id: string }> };

function parseCursor(req: NextRequest): bigint {
  const raw = req.nextUrl.searchParams.get('after');
  if (!raw) return BigInt(0);
  try {
    const cursor = BigInt(raw);
    return cursor >= BigInt(0) ? cursor : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/** Return tenant-scoped job state plus replayable events after an event id. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { org } = await requireAuth();
    const { id } = await params;
    const job = await prisma.job.findFirst({
      where: { id, orgId: org.id },
      select: {
        id: true, sessionId: true, type: true, status: true, priority: true,
        attempts: true, maxAttempts: true, runAfter: true,
        cancelRequestedAt: true, startedAt: true, completedAt: true,
        errorCode: true, errorMessage: true, result: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const events = await prisma.jobEvent.findMany({
      where: { jobId: id, id: { gt: parseCursor(req) } },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return NextResponse.json({
      job,
      events: events.map(event => ({ ...event, id: event.id.toString() })),
    });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Request cancellation; queued jobs are cancelled immediately. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { org } = await requireAuth();
    const { id } = await params;
    const owned = await prisma.job.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const status = await requestJobCancellation(id);
    return NextResponse.json({ status });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
