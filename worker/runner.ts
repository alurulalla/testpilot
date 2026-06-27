import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { claimNextJob, completeJob, heartbeatJob, retryJob } from '@/lib/jobs/queue';
import { disconnectPrisma, prisma } from '@/lib/prisma';
import { runDiscoverJob } from './handlers/discover';
import { runGenerateJob } from './handlers/generate';
import { runExecuteJob } from './handlers/execute';
import { runPipelineJob } from './handlers/pipeline';
import { runFigmaJob } from './handlers/figma';
import { JobCancelledError, JobLeaseLostError } from './errors';

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1_000);
const LEASE_MS = Number(process.env.WORKER_LEASE_MS ?? 60_000);
const HEARTBEAT_MS = Math.max(2_000, Math.floor(LEASE_MS / 3));

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function dispatch(job: Job, workerId: string) {
  switch (job.type) {
    case 'pipeline': return runPipelineJob(job, workerId);
    case 'discover': return runDiscoverJob(job, workerId);
    case 'generate': return runGenerateJob(job, workerId);
    case 'execute': return runExecuteJob(job, workerId);
    case 'figma': return runFigmaJob(job, workerId);
    default: throw Object.assign(new Error(`No handler registered for job type: ${job.type}`), { code: 'UNKNOWN_JOB_TYPE' });
  }
}

async function execute(job: Job, workerId: string): Promise<void> {
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void heartbeatJob(job.id, workerId, LEASE_MS)
      .then(ok => { if (!ok) leaseLost = true; })
      .catch(() => { leaseLost = true; });
  }, HEARTBEAT_MS);

  try {
    const result = await dispatch(job, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    await completeJob(job.id, workerId, 'succeeded', { result: result as Prisma.InputJsonValue });
  } catch (err) {
    if (err instanceof JobLeaseLostError) return;
    if (err instanceof JobCancelledError) {
      await completeJob(job.id, workerId, 'cancelled');
      if (job.sessionId && job.type !== 'figma') {
        await prisma.session.updateMany({ where: { id: job.sessionId }, data: { status: 'idle' } });
      }
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? 'JOB_FAILED';
    const retried = await retryJob(job.id, workerId, { code, message }, Math.min(60_000, 2 ** job.attempts * 1_000));
    if (job.sessionId) {
      if (retried.status === 'failed' && job.type !== 'figma') {
        await prisma.session.updateMany({
          where: { id: job.sessionId },
          data: { status: 'failed', error: message },
        });
      } else if (retried.status === 'cancelled') {
        await prisma.session.updateMany({ where: { id: job.sessionId }, data: { status: 'idle' } });
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runWorker(options: { once?: boolean } = {}): Promise<void> {
  if (!Number.isInteger(POLL_MS) || POLL_MS < 100 || POLL_MS > 60_000) throw new Error('Invalid WORKER_POLL_MS');
  if (!Number.isInteger(LEASE_MS) || LEASE_MS < 5_000 || LEASE_MS > 15 * 60_000) throw new Error('Invalid WORKER_LEASE_MS');

  const workerId = process.env.WORKER_ID ?? `${os.hostname()}:${process.pid}:${randomUUID()}`;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(`[worker] started ${workerId}`);

  try {
    do {
      const job = await claimNextJob({ workerId, leaseMs: LEASE_MS });
      if (job) await execute(job, workerId);
      else if (!options.once && !stopping) await delay(POLL_MS);
    } while (!options.once && !stopping);
  } finally {
    await disconnectPrisma();
    console.log(`[worker] stopped ${workerId}`);
  }
}
