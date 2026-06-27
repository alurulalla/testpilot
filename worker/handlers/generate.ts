import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { getSessionDir } from '@/lib/config';
import { parseGeneratePayload } from '@/lib/jobs/generate-payload';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { runGenerateSuite, Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { snapshotTestFiles } from '@/lib/session-files';
import { JobCancelledError, JobLeaseLostError } from '../errors';
import { writeContextMd } from '@/lib/build-context-md';
import { contextToEnv, contextToPromptHint, getUrlContext } from '@/lib/url-context-store';
import type { ImportedProject, UserFlow } from '@/types/session';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getFeatureContext } from '@/lib/feature-context';
import { hostOf } from '@/lib/app-profile';

export async function runGenerateJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Generate job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session) throw new Error('Session not found for generate job');
  if (!session.siteMap) throw Object.assign(new Error('Run exploration before generation'), { code: 'MISSING_SITE_MAP' });
  const { depth, maxPages } = parseGeneratePayload(job.payload);

  await prisma.session.update({ where: { id: session.id }, data: { status: 'generating', error: null } });
  await appendJobEvent(job.id, 'generate.preparing');

  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  workspace.init();
  workspace.writeSiteMap(session.siteMap);
  writeContextMd(
    workspace.dir,
    session.contextDoc,
    (session.userFlows as unknown as UserFlow[] | null) ?? [],
    session.importedProject as unknown as ImportedProject | null,
  );
  const urlContext = await getUrlContext(session.url, session.orgId);
  if (urlContext?.fields.some(field => field.value)) {
    const envPath = path.join(workspace.dir, '.env');
    const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const additions = Object.entries(contextToEnv(urlContext))
      .filter(([key]) => !existing.split('\n').some(line => line.startsWith(`${key}=`)))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
    if (additions.length > 0) {
      writeFileSync(envPath, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`, 'utf8');
    }
    const hint = contextToPromptHint(urlContext);
    if (hint) {
      const contextPath = path.join(workspace.dir, 'CONTEXT.md');
      const context = existsSync(contextPath) ? readFileSync(contextPath, 'utf8').trimEnd() : '';
      writeFileSync(contextPath, `${context}\n\n---\n\n# Test Credentials & Context\n\n${hint}\n`, 'utf8');
    }
  }
  await workspace.installDeps();

  let cancelled = false;
  let leaseLost = false;
  let checking = false;
  const cancellationTimer = setInterval(() => {
    if (checking) return;
    checking = true;
    void isJobCancellationRequested(job.id, workerId)
      .then(value => { cancelled = value; })
      .catch(() => { leaseLost = true; })
      .finally(() => { checking = false; });
  }, 1_000);

  try {
    const llmConfig = await getOrgLlmConfig(session.orgId);
    const baseModel = await createModelFromConfig(llmConfig);
    const appContext = await getFeatureContext(session.orgId, hostOf(session.url));
    await appendJobEvent(job.id, 'generate.started', { model: llmConfig.model });
    await runGenerateSuite({
      skipExplore: true,
      depth,
      maxPages,
      model: llmConfig.model,
      chatModel: withRateLimit(baseModel),
      workspace,
      appContext,
      shouldStop: () => cancelled || leaseLost,
    });
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();

    const testFiles = workspace.testFiles();
    await snapshotTestFiles(session.id, workspace);
    await prisma.session.update({
      where: { id: session.id },
      data: { testFiles: testFiles as Prisma.InputJsonValue, status: 'idle', error: null },
    });
    await appendJobEvent(job.id, 'generate.completed', { files: testFiles.length });
    return { files: testFiles.length };
  } finally {
    clearInterval(cancellationTimer);
  }
}
