import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { getSessionDir } from '@/lib/config';
import { isFigmaConfigured, runFigmaComparison } from '@/lib/figma-client';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgFigmaToken, getOrgLlmConfig } from '@/lib/llm-config-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { ensureWorkspaceReady, snapshotTestFiles } from '@/lib/session-files';
import { JobCancelledError, JobLeaseLostError } from '../errors';

export async function runFigmaJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Figma job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session) throw new Error('Session not found for Figma job');
  const token = await getOrgFigmaToken(session.orgId);
  if (!isFigmaConfigured(token, session.figmaFileUrl)) {
    throw Object.assign(new Error('Figma token or file URL is not configured'), { code: 'FIGMA_NOT_CONFIGURED' });
  }

  await prisma.session.update({ where: { id: session.id }, data: { figmaChecking: true } });
  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  await ensureWorkspaceReady(session.id, workspace);

  let cancelled = false;
  let leaseLost = false;
  const timer = setInterval(() => {
    void isJobCancellationRequested(job.id, workerId)
      .then(value => { cancelled = value; })
      .catch(() => { leaseLost = true; });
  }, 1_000);
  let eventChain = Promise.resolve();
  const progress = (message: string) => {
    eventChain = eventChain
      .then(() => appendJobEvent(job.id, 'figma.progress', { message: message.slice(0, 2_000) }))
      .then(() => undefined);
  };

  try {
    const llmConfig = await getOrgLlmConfig(session.orgId);
    const model = withRateLimit(await createModelFromConfig(llmConfig));
    const siteMap = session.siteMap as { pages?: Array<{ url?: string }> } | null;
    const knownUrls = (siteMap?.pages ?? [])
      .map(page => page.url)
      .filter((url): url is string => typeof url === 'string');
    const result = await runFigmaComparison(
      token!,
      session.figmaFileUrl!,
      session.url,
      workspace.dir,
      knownUrls,
      progress,
      model,
      session.figmaFrameMap as Record<string, string> | null,
      { orgId: session.orgId, host: new URL(session.url).hostname.replace(/^www\./, '') },
      () => cancelled || leaseLost,
    );
    await eventChain;
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();

    await snapshotTestFiles(session.id, workspace);
    const testFiles = workspace.testFiles();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        figmaResult: result as unknown as Prisma.InputJsonValue,
        figmaChecking: false,
        testFiles: testFiles as Prisma.InputJsonValue,
      },
    });
    const totalIssues = result.comparisons.reduce((sum, comparison) =>
      sum + (comparison.discrepancies?.length ?? 0), 0);
    return { frames: result.comparisons.length, issues: totalIssues };
  } finally {
    clearInterval(timer);
    await eventChain.catch(() => undefined);
    await prisma.session.updateMany({ where: { id: session.id }, data: { figmaChecking: false } });
    await prisma.session.updateMany({
      where: { id: session.id, status: 'figma-checking' },
      data: { status: 'idle' },
    });
  }
}
