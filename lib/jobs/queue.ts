import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { assertJobTransition, type JobStatus, type JobType } from './types';

export interface EnqueueJobInput {
  orgId: string;
  sessionId?: string;
  type: JobType;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
}

export interface ClaimOptions {
  workerId: string;
  leaseMs?: number;
}

function prismaCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

export async function enqueueJob(input: EnqueueJobInput) {
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (input.maxAttempts !== undefined &&
      (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20)) {
    throw new Error('maxAttempts must be an integer between 1 and 20');
  }

  try {
    return await prisma.$transaction(async tx => {
      if (idempotencyKey) {
        const existing = await tx.job.findUnique({
          where: { orgId_idempotencyKey: { orgId: input.orgId, idempotencyKey } },
        });
        if (existing) return { job: existing, created: false };
      }

      const job = await tx.job.create({
        data: {
          orgId: input.orgId,
          sessionId: input.sessionId,
          type: input.type,
          payload: input.payload,
          idempotencyKey,
          priority: input.priority ?? 0,
          maxAttempts: input.maxAttempts ?? 3,
          runAfter: input.runAfter ?? new Date(),
          eventSeq: 1,
          events: { create: { seq: 1, type: 'job.queued', payload: { type: input.type } } },
        },
      });
      return { job, created: true };
    }, { isolationLevel: 'Serializable' });
  } catch (err) {
    // Concurrent requests with the same key can race before the unique insert.
    if (idempotencyKey && (prismaCode(err) === 'P2002' || prismaCode(err) === 'P2034')) {
      const existing = await prisma.job.findUnique({
        where: { orgId_idempotencyKey: { orgId: input.orgId, idempotencyKey } },
      });
      if (existing) return { job: existing, created: false };
    }
    throw err;
  }
}

export async function claimNextJob({ workerId, leaseMs = 60_000 }: ClaimOptions) {
  if (!workerId.trim()) throw new Error('workerId is required');
  if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 15 * 60_000) {
    throw new Error('leaseMs must be between 5000 and 900000');
  }

  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; attempts: number; previousStatus: string }>>(Prisma.sql`
      WITH candidate AS (
        SELECT "id", "status"
        FROM "Job"
        WHERE (
          ("status" IN ('queued', 'retrying') AND "runAfter" <= NOW())
          OR ("status" = 'running' AND "leaseExpiresAt" < NOW())
        )
          AND "cancelRequestedAt" IS NULL
          AND "attempts" < "maxAttempts"
        ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "Job" AS job
      SET "status" = 'running',
          "attempts" = job."attempts" + 1,
          "leaseOwner" = ${workerId},
          "leaseExpiresAt" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
          "startedAt" = COALESCE(job."startedAt", NOW()),
          "updatedAt" = NOW()
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."attempts", candidate."status" AS "previousStatus"
    `);
    const claimed = rows[0];
    if (!claimed) return null;

    if (claimed.previousStatus === 'running') {
      await tx.jobAttempt.updateMany({
        where: { jobId: claimed.id, status: 'running' },
        data: { status: 'abandoned', completedAt: new Date(), errorCode: 'LEASE_EXPIRED' },
      });
    }
    await tx.jobAttempt.create({
      data: { jobId: claimed.id, number: claimed.attempts, workerId },
    });
    const sequenced = await tx.job.update({
      where: { id: claimed.id },
      data: { eventSeq: { increment: 1 } },
    });
    await tx.jobEvent.create({
      data: {
        jobId: claimed.id,
        seq: sequenced.eventSeq,
        type: claimed.previousStatus === 'running' ? 'job.reclaimed' : 'job.started',
        payload: { workerId, attempt: claimed.attempts },
      },
    });
    return tx.job.findUniqueOrThrow({ where: { id: claimed.id } });
  });
}

export async function heartbeatJob(jobId: string, workerId: string, leaseMs = 60_000): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const result = await prisma.$transaction(async tx => {
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: 'running', leaseOwner: workerId, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt },
    });
    if (updated.count === 0) return false;
    await tx.jobAttempt.updateMany({
      where: { jobId, workerId, status: 'running' },
      data: { heartbeatAt: now },
    });
    return true;
  });
  return result;
}

export async function isJobCancellationRequested(jobId: string, workerId: string): Promise<boolean> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'running', leaseOwner: workerId },
    select: { cancelRequestedAt: true },
  });
  if (!job) throw new Error('Job lease is no longer owned by this worker');
  return job.cancelRequestedAt !== null;
}

export async function appendJobEvent(jobId: string, type: string, payload?: Prisma.InputJsonValue) {
  return prisma.$transaction(async tx => {
    const job = await tx.job.update({ where: { id: jobId }, data: { eventSeq: { increment: 1 } } });
    return tx.jobEvent.create({
      data: { jobId, seq: job.eventSeq, type, ...(payload === undefined ? {} : { payload }) },
    });
  });
}

/** Persist a restart-safe orchestration checkpoint while retaining the lease. */
export async function checkpointJob(
  jobId: string,
  workerId: string,
  result: Prisma.InputJsonValue,
  eventType: string,
) {
  return prisma.$transaction(async tx => {
    const current = await tx.job.findFirst({
      where: { id: jobId, status: 'running', leaseOwner: workerId },
      select: { id: true },
    });
    if (!current) throw new Error('Job lease is no longer owned by this worker');
    const job = await tx.job.update({
      where: { id: jobId },
      data: { result, eventSeq: { increment: 1 } },
    });
    await tx.jobEvent.create({ data: { jobId, seq: job.eventSeq, type: eventType, payload: result } });
    return job;
  });
}

export async function requestJobCancellation(jobId: string): Promise<'requested' | 'cancelled' | 'terminal'> {
  return prisma.$transaction(async tx => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    const status = current.status as JobStatus;
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return 'terminal';

    const immediate = status === 'queued' || status === 'retrying';
    assertJobTransition(status, 'cancelled');
    const job = await tx.job.update({
      where: { id: jobId },
      data: immediate
        ? { status: 'cancelled', cancelRequestedAt: new Date(), completedAt: new Date(), eventSeq: { increment: 1 } }
        : { cancelRequestedAt: new Date(), eventSeq: { increment: 1 } },
    });
    await tx.jobEvent.create({
      data: { jobId, seq: job.eventSeq, type: immediate ? 'job.cancelled' : 'job.cancel_requested' },
    });
    return immediate ? 'cancelled' : 'requested';
  });
}

export async function completeJob(
  jobId: string,
  workerId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  options: { result?: Prisma.InputJsonValue; errorCode?: string; errorMessage?: string } = {},
) {
  return prisma.$transaction(async tx => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (current.status !== 'running' || current.leaseOwner !== workerId) {
      throw new Error('Job lease is no longer owned by this worker');
    }
    assertJobTransition('running', status);
    const now = new Date();
    const job = await tx.job.update({
      where: { id: jobId },
      data: {
        status,
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(options.result === undefined ? {} : { result: options.result }),
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
        eventSeq: { increment: 1 },
      },
    });
    await tx.jobAttempt.updateMany({
      where: { jobId, workerId, status: 'running' },
      data: {
        status,
        completedAt: now,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
      },
    });
    await tx.jobEvent.create({
      data: {
        jobId,
        seq: job.eventSeq,
        type: `job.${status}`,
        ...(options.result === undefined ? {} : { payload: options.result }),
      },
    });
    return job;
  });
}

export async function retryJob(
  jobId: string,
  workerId: string,
  error: { code?: string; message: string },
  delayMs: number,
) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 24 * 60 * 60_000) {
    throw new Error('delayMs must be between 0 and 86400000');
  }
  return prisma.$transaction(async tx => {
    const current = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (current.status !== 'running' || current.leaseOwner !== workerId) {
      throw new Error('Job lease is no longer owned by this worker');
    }
    const cancellationRequested = current.cancelRequestedAt !== null;
    const exhausted = current.attempts >= current.maxAttempts;
    const nextStatus: JobStatus = cancellationRequested ? 'cancelled' : exhausted ? 'failed' : 'retrying';
    assertJobTransition('running', nextStatus);
    const now = new Date();
    const job = await tx.job.update({
      where: { id: jobId },
      data: {
        status: nextStatus,
        runAfter: exhausted || cancellationRequested ? current.runAfter : new Date(now.getTime() + delayMs),
        completedAt: exhausted || cancellationRequested ? now : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: error.code,
        errorMessage: error.message,
        eventSeq: { increment: 1 },
      },
    });
    await tx.jobAttempt.updateMany({
      where: { jobId, workerId, status: 'running' },
      data: {
        status: cancellationRequested ? 'cancelled' : 'failed',
        completedAt: now,
        errorCode: error.code,
        errorMessage: error.message,
      },
    });
    await tx.jobEvent.create({
      data: {
        jobId,
        seq: job.eventSeq,
        type: cancellationRequested ? 'job.cancelled' : exhausted ? 'job.failed' : 'job.retry_scheduled',
        ...(exhausted || cancellationRequested ? {} : { payload: { runAfter: job.runAfter.toISOString() } }),
      },
    });
    return job;
  });
}
