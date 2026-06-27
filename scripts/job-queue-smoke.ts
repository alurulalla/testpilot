import '@/lib/load-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  appendJobEvent,
  checkpointJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  heartbeatJob,
  isJobCancellationRequested,
  requestJobCancellation,
} from '@/lib/jobs/queue';
import { disconnectPrisma, prisma } from '@/lib/prisma';

async function main(): Promise<void> {
  const suffix = randomUUID();
  const workerId = `queue-smoke:${suffix}`;
  let orgId: string | undefined;

  try {
    const org = await prisma.organization.create({
    data: {
      name: `Queue Smoke ${suffix}`,
      slug: `queue-smoke-${suffix}`,
      createdByAdmin: 'queue-smoke@testpilot.local',
    },
  });
    orgId = org.id;

    const first = await enqueueJob({
    orgId,
    type: 'report',
    payload: { smoke: true },
    priority: 2_000_000_000,
    idempotencyKey: `queue-smoke:${suffix}`,
  });
    assert.equal(first.created, true);

    const duplicate = await enqueueJob({
    orgId,
    type: 'report',
    payload: { smoke: true },
    idempotencyKey: `queue-smoke:${suffix}`,
  });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, first.job.id);

    const claimed = await claimNextJob({ workerId, leaseMs: 30_000 });
    assert.equal(claimed?.id, first.job.id);
    assert.equal(await heartbeatJob(first.job.id, workerId, 30_000), true);

    await checkpointJob(first.job.id, workerId, { stage: 'smoke' }, 'smoke.checkpoint');

    await appendJobEvent(first.job.id, 'smoke.progress', { step: 1 });
    assert.equal(await requestJobCancellation(first.job.id), 'requested');
    assert.equal(await isJobCancellationRequested(first.job.id, workerId), true);
    await completeJob(first.job.id, workerId, 'cancelled');

    const completed = await prisma.job.findUniqueOrThrow({ where: { id: first.job.id } });
    assert.equal(completed.status, 'cancelled');
    assert.equal(completed.leaseOwner, null);

    const events = await prisma.jobEvent.findMany({
    where: { jobId: first.job.id },
    orderBy: { seq: 'asc' },
  });
    assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
    assert.deepEqual(events.map(event => event.type), [
      'job.queued', 'job.started', 'smoke.checkpoint', 'smoke.progress', 'job.cancel_requested', 'job.cancelled',
    ]);

    // Simulate a worker crash by expiring its lease, then verify another worker
    // reclaims the job and the abandoned attempt remains auditable.
    const restart = await enqueueJob({
      orgId,
      type: 'report',
      payload: { restart: true },
      priority: 2_000_000_000,
      idempotencyKey: `queue-restart:${suffix}`,
    });
    const firstClaim = await claimNextJob({ workerId: `${workerId}:crashed`, leaseMs: 30_000 });
    assert.equal(firstClaim?.id, restart.job.id);
    await prisma.job.update({
      where: { id: restart.job.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const replacementWorker = `${workerId}:replacement`;
    const reclaimed = await claimNextJob({ workerId: replacementWorker, leaseMs: 30_000 });
    assert.equal(reclaimed?.id, restart.job.id);
    assert.equal(reclaimed?.attempts, 2);
    const attempts = await prisma.jobAttempt.findMany({
      where: { jobId: restart.job.id },
      orderBy: { number: 'asc' },
    });
    assert.deepEqual(attempts.map(attempt => attempt.status), ['abandoned', 'running']);
    await completeJob(restart.job.id, replacementWorker, 'succeeded');

    // A session Stop request cancels every queued sibling. Exercise the queue
    // half of that contract with parallel pipeline and Figma jobs.
    const pipeline = await enqueueJob({
      orgId,
      type: 'pipeline',
      payload: { maxIterations: 1 },
      idempotencyKey: `queue-pipeline:${suffix}`,
    });
    const figma = await enqueueJob({
      orgId,
      type: 'figma',
      payload: {},
      idempotencyKey: `queue-figma:${suffix}`,
    });
    assert.equal(await requestJobCancellation(pipeline.job.id), 'cancelled');
    assert.equal(await requestJobCancellation(figma.job.id), 'cancelled');
    const siblings = await prisma.job.findMany({
      where: { id: { in: [pipeline.job.id, figma.job.id] } },
      orderBy: { type: 'asc' },
    });
    assert.deepEqual(siblings.map(job => job.status), ['cancelled', 'cancelled']);

    console.log(`Queue smoke test passed (${events.length} ordered events, lease recovery, sibling cancellation).`);
  } finally {
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await disconnectPrisma();
  }
}

void main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
