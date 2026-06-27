import { type Job } from '@/lib/generated/prisma/client';
import { hostOf } from '@/lib/app-profile';
import { getSessionDir } from '@/lib/config';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { getOrgSettings } from '@/lib/org-settings';
import { Workspace } from '@/lib/pilot';
import { generateDeepBehaviorTests } from '@/lib/pilot/deep-behavior';
import { runLocatorDryRun } from '@/lib/pilot/locator-dryrun';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { performPreLogin } from '@/lib/pre-login';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { reviewGeneratedTests } from '@/lib/review-tests';
import { ensureWorkspaceReady, snapshotTestFiles } from '@/lib/session-files';
import { getUrlContext } from '@/lib/url-context-store';
import type { SiteMap } from '@/types/session';
import { JobCancelledError, JobLeaseLostError } from '../errors';

export async function runQualityJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Quality job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session?.siteMap) throw new Error('Session sitemap is required for quality review');
  const siteMap = session.siteMap as unknown as SiteMap;
  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  await ensureWorkspaceReady(session.id, workspace);
  workspace.writeSiteMap(siteMap);

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
      .then(() => appendJobEvent(job.id, 'quality.progress', { message: message.slice(0, 2_000) }))
      .then(() => undefined);
  };
  const ensureActive = async () => {
    await eventChain;
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();
  };

  try {
    const llmConfig = await getOrgLlmConfig(session.orgId);
    const model = withRateLimit(await createModelFromConfig(llmConfig));
    const settings = await getOrgSettings(session.orgId);
    const host = hostOf(session.url);
    const coverageFiles = 0;

    let authFile: string | undefined;
    if (settings.deepBehavior || settings.locatorDryRun) {
      const context = await getUrlContext(session.url, session.orgId);
      if (context?.fields.some(field => field.value)) {
        const login = await performPreLogin(session.url, context.fields, workspace.dir, progress);
        if (login.success && new URL(login.postLoginUrl).origin === new URL(session.url).origin) {
          authFile = login.authFile;
        }
        await ensureActive();
      }
    }

    let deepFiles = 0;
    if (settings.deepBehavior) {
      progress('Running bounded deep-behavior discovery for critical features.');
      const deep = await generateDeepBehaviorTests({
        orgId: session.orgId,
        host,
        startUrl: siteMap.start_url || session.url,
        workspace,
        model,
        authFile,
        onProgress: progress,
        shouldStop: () => cancelled || leaseLost,
      });
      deepFiles = deep.filesWritten.length;
      await ensureActive();
    }

    progress('Reviewing generated tests against crawled elements and quality rules.');
    const review = await reviewGeneratedTests(workspace, model, progress);
    await ensureActive();

    let locatorRepairs = 0;
    if (settings.locatorDryRun) {
      progress('Running live locator validation and high-confidence repair.');
      const dryRun = await runLocatorDryRun({
        workspace,
        baseUrl: siteMap.start_url || session.url,
        authFile,
        onProgress: progress,
        shouldStop: () => cancelled || leaseLost,
      });
      locatorRepairs = dryRun.repaired;
      await ensureActive();
    }

    await snapshotTestFiles(session.id, workspace);
    await prisma.session.update({ where: { id: session.id }, data: { testFiles: workspace.testFiles() } });
    return {
      coverageFiles,
      deepFiles,
      reviewedFiles: review.reviewed,
      correctedFiles: review.fixed,
      locatorRepairs,
    };
  } finally {
    clearInterval(timer);
    await eventChain.catch(() => undefined);
  }
}
