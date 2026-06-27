import { type Job } from '@/lib/generated/prisma/client';
import {
  appProfileExists,
  ensureAppProfile,
  hostOf,
  mergeDiscoveredFeatures,
  tagTestsToFeatures,
} from '@/lib/app-profile';
import { getSessionDir } from '@/lib/config';
import { getFeatureContext } from '@/lib/feature-context';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { Workspace } from '@/lib/pilot';
import { discoverSelectors } from '@/lib/pilot/discover-selectors';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { prisma } from '@/lib/prisma';
import { synthesizeFeatures, type DiscoveredFeature } from '@/lib/synthesize-features';
import type { SiteMap, UserFlow } from '@/types/session';
import { JobCancelledError, JobLeaseLostError } from '../errors';

export async function runProfileJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Profile job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session?.siteMap) throw new Error('Session sitemap is required for profiling');
  const siteMap = session.siteMap as unknown as SiteMap;
  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  workspace.init();
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
      .then(() => appendJobEvent(job.id, 'profile.progress', { message: message.slice(0, 2_000) }))
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
    if (session.contextDoc) {
      progress('Discovering selectors grounded in the crawled DOM.');
      const selectorMaps = await discoverSelectors({
        siteMap: siteMap as unknown as Parameters<typeof discoverSelectors>[0]['siteMap'],
        contextMd: session.contextDoc,
        model,
        onProgress: progress,
      });
      if (selectorMaps.length > 0) workspace.writeSelectorHints(selectorMaps);
      await ensureActive();
    }

    progress('Synthesizing user-facing features from the crawl.');
    const flowNames = ((session.userFlows as unknown as UserFlow[] | null) ?? [])
      .map(flow => flow.title)
      .filter(Boolean);
    const discovered = await synthesizeFeatures({
      siteMap: siteMap as unknown as Parameters<typeof synthesizeFeatures>[0]['siteMap'],
      model,
      docFeatureNames: flowNames,
      onProgress: progress,
    });
    if (discovered.length > 0) workspace.writeFeatures(discovered);
    await ensureActive();

    const host = hostOf(session.url);
    const existed = await appProfileExists(session.orgId, host);
    const frameMap = session.figmaFrameMap as Record<string, string> | null;
    await ensureAppProfile({
      orgId: session.orgId,
      host,
      siteMap,
      docContent: session.contextDoc,
      figmaContext: frameMap && Object.keys(frameMap).length > 0
        ? `Figma screens: ${Object.keys(frameMap).join(', ')}`
        : null,
      discoveredFeatures: discovered.length > 0
        ? discovered as unknown as DiscoveredFeature[]
        : undefined,
      model,
      onProgress: progress,
    });
    if (existed && discovered.length > 0) {
      await mergeDiscoveredFeatures(session.orgId, host, discovered);
    }
    await tagTestsToFeatures(session.orgId, host);
    await ensureActive();
    const appContext = await getFeatureContext(session.orgId, host);
    return { features: discovered.length, contextChars: appContext.length };
  } finally {
    clearInterval(timer);
    await eventChain.catch(() => undefined);
  }
}
