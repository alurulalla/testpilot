import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { getSessionDir } from '@/lib/config';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { runTestsAsync } from '@/lib/run-tests-async';
import { ensureWorkspaceReady } from '@/lib/session-files';
import { importedExecutionBlocked, IMPORTED_EXECUTION_BLOCKED_MESSAGE } from '@/lib/security/execution-policy';
import { attachTriageToRun, recordTestRun } from '@/lib/test-runs';
import { triageFailures } from '@/lib/triage-failures';
import { JobCancelledError, JobLeaseLostError } from '../errors';

export async function runExecuteJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Execute job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session) throw new Error('Session not found for execute job');
  if (importedExecutionBlocked(session.importedProject)) {
    throw Object.assign(new Error(IMPORTED_EXECUTION_BLOCKED_MESSAGE), { code: 'IMPORTED_EXECUTION_BLOCKED' });
  }

  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  const restored = await ensureWorkspaceReady(session.id, workspace);
  const testFiles = workspace.testFiles();
  if (testFiles.length === 0) throw Object.assign(new Error('No tests to run'), { code: 'NO_TESTS' });

  await prisma.session.update({
    where: { id: session.id },
    data: { status: 'running', error: null, triageResult: Prisma.JsonNull },
  });
  await appendJobEvent(job.id, 'execute.preparing', { restoredFiles: restored, files: testFiles.length });

  const abortController = new AbortController();
  let cancelled = false;
  let leaseLost = false;
  let checking = false;
  const cancellationTimer = setInterval(() => {
    if (checking) return;
    checking = true;
    void isJobCancellationRequested(job.id, workerId)
      .then(value => {
        cancelled = value;
        if (value) abortController.abort();
      })
      .catch(() => {
        leaseLost = true;
        abortController.abort();
      })
      .finally(() => { checking = false; });
  }, 1_000);

  let outputBuffer: string[] = [];
  let eventChain = Promise.resolve();
  const flushOutput = () => {
    if (outputBuffer.length === 0) return;
    const lines = outputBuffer;
    outputBuffer = [];
    eventChain = eventChain
      .then(() => appendJobEvent(job.id, 'execute.output', { lines }))
      .then(() => undefined);
  };
  const outputTimer = setInterval(flushOutput, 750);

  try {
    const result = await runTestsAsync(
      workspace,
      line => {
        outputBuffer.push(line.slice(0, 2_000));
        if (outputBuffer.length >= 20) flushOutput();
      },
      session.id,
      session.headedMode,
      undefined,
      undefined,
      abortController.signal,
    );
    flushOutput();
    await eventChain;
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();

    await prisma.session.update({
      where: { id: session.id },
      data: { testResult: result as unknown as Prisma.InputJsonValue, status: 'idle', error: null },
    });
    const runId = await recordTestRun(session.id, result, { trigger: 'manual' });
    await appendJobEvent(job.id, 'execute.completed', result.stats as unknown as Prisma.InputJsonValue);

    if (result.stats.failed > 0) {
      try {
        await appendJobEvent(job.id, 'triage.started');
        const llmConfig = await getOrgLlmConfig(session.orgId);
        const baseModel = await createModelFromConfig(llmConfig);
        const triage = await triageFailures(
          workspace,
          session.contextDoc,
          session.url,
          withRateLimit(baseModel),
          line => {
            outputBuffer.push(line.slice(0, 2_000));
            if (outputBuffer.length >= 20) flushOutput();
          },
        );
        flushOutput();
        await eventChain;
        await prisma.session.update({
          where: { id: session.id },
          data: { triageResult: triage as unknown as Prisma.InputJsonValue },
        });
        await attachTriageToRun(runId, triage);
        await appendJobEvent(job.id, 'triage.completed', {
          appBugs: triage.appBugCount,
          testBugs: triage.testBugCount,
          ambiguous: triage.ambiguousCount,
        });
      } catch (error) {
        await appendJobEvent(job.id, 'triage.skipped', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { runId, stats: result.stats } as unknown as Prisma.InputJsonValue;
  } finally {
    clearInterval(cancellationTimer);
    clearInterval(outputTimer);
    flushOutput();
    await eventChain.catch(() => undefined);
  }
}
