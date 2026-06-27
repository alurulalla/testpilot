import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { enqueueJob } from '@/lib/jobs/queue';
import { parsePipelinePayload } from '@/lib/jobs/pipeline-state';
import { prisma } from '@/lib/prisma';
import { addLog, updateSession } from '@/lib/session-store';
import { importedExecutionBlocked, IMPORTED_EXECUTION_BLOCKED_MESSAGE } from '@/lib/security/execution-policy';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (importedExecutionBlocked(session.importedProject)) {
    return NextResponse.json({ error: IMPORTED_EXECUTION_BLOCKED_MESSAGE }, { status: 409 });
  }

  const active = await prisma.job.findFirst({
    where: { sessionId: id, status: { in: ['queued', 'running', 'retrying'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) return NextResponse.json({ started: false, jobId: active.id, status: active.status });

  const body = await req.json().catch(() => ({}));
  let payload;
  try {
    payload = parsePipelinePayload(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid pipeline options' },
      { status: 400 },
    );
  }

  const fresh = await prisma.session.findUnique({ where: { id }, select: { updatedAt: true } });
  if (!fresh) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    || `pipeline:${id}:${fresh.updatedAt.getTime()}`;
  const { job } = await enqueueJob({
    orgId: session.orgId,
    sessionId: id,
    type: 'pipeline',
    payload: { maxIterations: payload.maxIterations },
    idempotencyKey,
    maxAttempts: 3,
  });
  await prisma.session.update({
    where: { id },
    data: { status: 'exploring', error: null, iteration: 0 },
  });
  updateSession(id, { status: 'exploring', error: null, iteration: 0 });
  addLog(id, `Full pipeline queued as job ${job.id}`, 'info');
  return NextResponse.json({ started: true, jobId: job.id, status: job.status }, { status: 202 });
}
