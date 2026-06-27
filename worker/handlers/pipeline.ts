import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { getSessionDir } from '@/lib/config';
import {
  failureSignature,
  parsePipelineCheckpoint,
  parsePipelinePayload,
  type PipelineCheckpoint,
} from '@/lib/jobs/pipeline-state';
import { checkpointJob, enqueueJob, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgFigmaToken, getOrgLlmConfig } from '@/lib/llm-config-store';
import { getOrgSettings } from '@/lib/org-settings';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { snapshotTestFiles, ensureWorkspaceReady } from '@/lib/session-files';
import { clearStopping, markStopping } from '@/lib/session-store';
import { attachFixToRun } from '@/lib/test-runs';
import { fixSyntaxErrors, fixTestsPerFile } from '@/lib/fix-tests-per-file';
import { healWithAgent } from '@/lib/heal-agent';
import type { TestResult, TriageResult } from '@/types/session';
import { JobCancelledError } from '../errors';
import { runAdvancedDiscoverJob } from './discover';
import { runExecuteJob } from './execute';
import { runGenerateJob } from './generate';
import { runProfileJob } from './profile';
import { runQualityJob } from './quality';
import { isFigmaConfigured } from '@/lib/figma-client';

function checkpointValue(checkpoint: PipelineCheckpoint): Prisma.InputJsonValue {
  return checkpoint as unknown as Prisma.InputJsonValue;
}

async function ensureNotCancelled(job: Job, workerId: string): Promise<void> {
  if (await isJobCancellationRequested(job.id, workerId)) throw new JobCancelledError();
}

export async function runPipelineJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Pipeline job requires a sessionId');
  const { maxIterations } = parsePipelinePayload(job.payload);
  let checkpoint = parsePipelineCheckpoint(job.result);

  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session) throw new Error('Session not found for pipeline job');

  if (checkpoint.stage === 'initial') {
    await ensureNotCancelled(job, workerId);
    await runAdvancedDiscoverJob(job, workerId);
    checkpoint = { stage: 'discovered', iteration: 1 };
    await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.discovered');

  }

  // Idempotent on resume: a crash after the discovery checkpoint but before
  // enqueueing Figma verification must not silently lose the parallel job.
  if (checkpoint.stage === 'discovered') {
    const discoveredSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const figmaToken = await getOrgFigmaToken(session.orgId);
    if (isFigmaConfigured(figmaToken, discoveredSession.figmaFileUrl)) {
      const figma = await enqueueJob({
        orgId: session.orgId,
        sessionId: session.id,
        type: 'figma',
        payload: { parentPipelineJobId: job.id },
        idempotencyKey: `figma:pipeline:${job.id}`,
        maxAttempts: 2,
      });
      await prisma.session.update({ where: { id: session.id }, data: { figmaChecking: true } });
      await checkpointJob(
        job.id,
        workerId,
        checkpointValue(checkpoint),
        figma.created ? 'pipeline.figma_queued' : 'pipeline.figma_exists',
      );
    }
  }

  if (checkpoint.stage === 'discovered') {
    await ensureNotCancelled(job, workerId);
    await runProfileJob(job, workerId);
    checkpoint = { stage: 'profiled', iteration: 1 };
    await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.profiled');
  }

  if (checkpoint.stage === 'profiled') {
    await ensureNotCancelled(job, workerId);
    await runGenerateJob(job, workerId);
    checkpoint = { stage: 'generated', iteration: 1 };
    await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.generated');
  }

  if (checkpoint.stage === 'generated') {
    await ensureNotCancelled(job, workerId);
    await runQualityJob(job, workerId);
    checkpoint = { stage: 'reviewed', iteration: 1 };
    await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.reviewed');
  }

  while (checkpoint.iteration <= maxIterations) {
    if (checkpoint.stage === 'reviewed' || checkpoint.stage === 'healed') {
      await ensureNotCancelled(job, workerId);
      await prisma.session.update({
        where: { id: session.id },
        data: { iteration: checkpoint.iteration },
      });
      await runExecuteJob(job, workerId);

      const executed = await prisma.session.findUniqueOrThrow({
        where: { id: session.id },
        select: { testResult: true },
      });
      const result = executed.testResult as unknown as TestResult | null;
      const currentSignature = failureSignature(result?.cases);
      const noProgress = Boolean(currentSignature && currentSignature === checkpoint.lastFailureSignature);
      checkpoint = {
        stage: 'executed',
        iteration: checkpoint.iteration,
        lastFailureSignature: currentSignature,
        ...(noProgress ? { stopReason: 'no_progress' } : {}),
      };
      await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.executed');
    }

    const fresh = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    const testResult = fresh.testResult as unknown as TestResult | null;
    if ((testResult?.stats.failed ?? 0) === 0 && (testResult?.stats.errors ?? 0) === 0) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'complete', error: null } });
      return { outcome: 'passed', iteration: checkpoint.iteration } as Prisma.InputJsonValue;
    }
    if (checkpoint.stopReason === 'no_progress') {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'idle' } });
      return { outcome: 'no_progress', iteration: checkpoint.iteration } as Prisma.InputJsonValue;
    }
    if (checkpoint.iteration >= maxIterations) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'idle' } });
      return { outcome: 'max_iterations', iteration: checkpoint.iteration } as Prisma.InputJsonValue;
    }

    const settings = await getOrgSettings(session.orgId);
    const triage = fresh.triageResult as unknown as TriageResult | null;
    const syntaxFailure = Boolean(testResult && testResult.stats.errors > 0 && testResult.stats.total === 0);
    if (!syntaxFailure && (!settings.autoSelfHeal || !triage?.selfHealRecommended)) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'idle' } });
      return {
        outcome: settings.autoSelfHeal ? 'not_healable' : 'healing_disabled',
        iteration: checkpoint.iteration,
      } as Prisma.InputJsonValue;
    }

    await ensureNotCancelled(job, workerId);
    await prisma.session.update({ where: { id: session.id }, data: { status: 'fixing' } });
    const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
    await ensureWorkspaceReady(session.id, workspace);
    const llmConfig = await getOrgLlmConfig(session.orgId);
    const baseModel = await createModelFromConfig(llmConfig);
    const chatModel = withRateLimit(baseModel);

    let cancellationChecking = false;
    const cancellationTimer = setInterval(() => {
      if (cancellationChecking) return;
      cancellationChecking = true;
      void isJobCancellationRequested(job.id, workerId)
        .then(cancelled => { if (cancelled) markStopping(session.id); })
        .catch(() => markStopping(session.id))
        .finally(() => { cancellationChecking = false; });
    }, 1_000);

    let fixResult: { fixed: boolean; filesChanged: number };
    try {
      if (syntaxFailure) {
        const fixed = await fixSyntaxErrors(workspace, testResult?.output ?? '', chatModel);
        fixResult = { fixed, filesChanged: fixed ? 1 : 0 };
      } else if (settings.healMode === 'agent') {
        const failures = (triage?.analyses ?? [])
          .filter(item => item.verdict !== 'app_bug' && item.verdict !== 'setup_error')
          .map(item => ({ file: item.file, title: item.testName, error: item.error }));
        const healed = await healWithAgent({
          workspace,
          model: chatModel,
          failures,
          sessionId: session.id,
        });
        fixResult = { fixed: healed.fixed, filesChanged: healed.filesChanged };
      } else {
        fixResult = await fixTestsPerFile(workspace, chatModel, undefined, session.id, triage?.analyses);
      }
    } finally {
      clearInterval(cancellationTimer);
      clearStopping(session.id);
    }
    await ensureNotCancelled(job, workerId);

    await prisma.session.update({
      where: { id: session.id },
      data: { fixResult: fixResult as Prisma.InputJsonValue },
    });
    if (fixResult.fixed) await snapshotTestFiles(session.id, workspace);
    const latestRun = await prisma.testRun.findFirst({
      where: { sessionId: session.id },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    await attachFixToRun(latestRun?.id ?? null, fixResult);

    if (!fixResult.fixed) {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'idle' } });
      return { outcome: 'no_fix', iteration: checkpoint.iteration } as Prisma.InputJsonValue;
    }

    checkpoint = {
      stage: 'healed',
      iteration: checkpoint.iteration + 1,
      lastFailureSignature: checkpoint.lastFailureSignature,
    };
    await checkpointJob(job.id, workerId, checkpointValue(checkpoint), 'pipeline.healed');
  }

  return { outcome: 'max_iterations', iteration: maxIterations } as Prisma.InputJsonValue;
}
