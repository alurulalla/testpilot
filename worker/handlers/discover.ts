import { Prisma, type Job } from '@/lib/generated/prisma/client';
import { appendJobEvent, isJobCancellationRequested } from '@/lib/jobs/queue';
import { prisma } from '@/lib/prisma';
import { getSessionDir } from '@/lib/config';
import { runSiteExplorer, Workspace } from '@/lib/pilot';
import { validateTargetUrl } from '@/lib/security/target-url';
import { JobCancelledError, JobLeaseLostError } from '../errors';
import { parseDiscoverPayload } from '@/lib/jobs/discover-payload';
import { getOrgSettings } from '@/lib/org-settings';
import { getUrlContext, saveUrlContext } from '@/lib/url-context-store';
import { extractCredentialsFromDoc } from '@/lib/extract-credentials-from-doc';
import { performPreLogin } from '@/lib/pre-login';
import { runAuthenticatedSiteExplorer } from '@/lib/authenticated-site-explorer';
import { compareCrawlToDocs } from '@/lib/compare-crawl-to-docs';
import { runBroadClickExplorer, runNavClickExplorer } from '@/lib/pilot/nav-click-explorer';
import type { SiteMap } from '@/types/session';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export async function runDiscoverJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Discover job requires a sessionId');
  const session = await prisma.session.findFirst({
    where: { id: job.sessionId, orgId: job.orgId },
  });
  if (!session) throw new Error('Session not found for discover job');
  await validateTargetUrl(session.url);
  const { depth, maxPages } = parseDiscoverPayload(job.payload);

  await prisma.session.update({
    where: { id: session.id },
    data: { status: 'exploring', error: null },
  });

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(session.id, session.orgId),
  });
  workspace.init();

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

  let eventChain = Promise.resolve();
  const progress = (message: string) => {
    eventChain = eventChain.then(() => appendJobEvent(job.id, 'discover.progress', { message })).then(() => undefined);
  };

  try {
    const siteMap = await runSiteExplorer({
      url: session.url,
      depth,
      maxPages,
      writeSiteMap: true,
      outputDir: workspace.dir,
      onProgress: progress,
      shouldStop: () => cancelled || leaseLost,
    });
    await eventChain;
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();

    await prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'idle',
        siteMap: siteMap as unknown as Prisma.InputJsonValue,
        pagesCount: siteMap.total_pages,
        error: null,
      },
    });
    return { pages: siteMap.total_pages, startUrl: siteMap.start_url };
  } finally {
    clearInterval(cancellationTimer);
    await eventChain.catch(() => undefined);
  }
}

/** Feature-parity discovery used by the durable full pipeline. */
export async function runAdvancedDiscoverJob(job: Job, workerId: string) {
  if (!job.sessionId) throw new Error('Discover job requires a sessionId');
  const session = await prisma.session.findFirst({ where: { id: job.sessionId, orgId: job.orgId } });
  if (!session) throw new Error('Session not found for discover job');
  await validateTargetUrl(session.url);

  await prisma.session.update({ where: { id: session.id }, data: { status: 'exploring', error: null } });
  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(session.id, session.orgId) });
  workspace.init();

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

  let eventChain = Promise.resolve();
  const progress = (message: string) => {
    eventChain = eventChain
      .then(() => appendJobEvent(job.id, 'discover.progress', { message: message.slice(0, 2_000) }))
      .then(() => undefined);
  };
  const ensureActive = async () => {
    await eventChain;
    cancelled = cancelled || await isJobCancellationRequested(job.id, workerId);
    if (leaseLost) throw new JobLeaseLostError();
    if (cancelled) throw new JobCancelledError();
  };

  try {
    let urlContext = await getUrlContext(session.url, session.orgId);
    if (session.contextDoc && !urlContext?.fields.some(field => field.value)) {
      const credentials = extractCredentialsFromDoc(session.contextDoc);
      if (credentials) {
        urlContext = await saveUrlContext(session.url, [
          { key: 'username', label: credentials.usernameLabel, type: 'text', value: credentials.username, sensitive: false },
          { key: 'password', label: 'Password', type: 'password', value: credentials.password, sensitive: true },
        ], session.orgId);
        progress('Credentials found in product documentation and stored securely for pre-login.');
      }
    }

    let startUrl = session.url;
    let authFile: string | undefined;
    if (urlContext?.fields.some(field => field.value)) {
      progress('Attempting pre-login before authenticated exploration.');
      const login = await performPreLogin(session.url, urlContext.fields, workspace.dir, progress);
      await ensureActive();
      if (login.success) {
        const originalOrigin = new URL(session.url).origin;
        const loginOrigin = new URL(login.postLoginUrl).origin;
        if (originalOrigin === loginOrigin) {
          await validateTargetUrl(login.postLoginUrl);
          startUrl = login.postLoginUrl;
          authFile = login.authFile;
          if (login.loginPageInfo) {
            const envPath = path.join(workspace.dir, '.env');
            const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
            const metadata: Record<string, string> = {
              TESTPILOT_LOGIN_URL: login.loginPageInfo.url,
              TESTPILOT_LOGIN_USERNAME_SELECTOR: login.loginPageInfo.usernameSelector,
              TESTPILOT_LOGIN_SUBMIT_TEXT: login.loginPageInfo.submitButtonText,
            };
            const additions = Object.entries(metadata)
              .filter(([key]) => !existing.split('\n').some(line => line.startsWith(`${key}=`)))
              .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
            if (additions.length > 0) {
              writeFileSync(envPath, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`, 'utf8');
            }
          }
          progress(`Pre-login succeeded; exploring from ${new URL(startUrl).pathname || '/'}.`);
        } else {
          progress('Pre-login redirected to another origin; authenticated state was not used.');
        }
      } else {
        progress(`Pre-login was unavailable: ${login.error ?? 'unknown reason'}.`);
      }
    }

    const settings = await getOrgSettings(session.orgId);
    const maxPages = authFile ? settings.deepCrawlMaxPages : (session.maxPages || settings.maxPages);
    const depth = authFile ? 3 : 2;
    let siteMap = authFile
      ? await runAuthenticatedSiteExplorer({
          url: startUrl,
          authFile,
          depth,
          maxPages,
          outputDir: workspace.dir,
          onProgress: progress,
          shouldStop: () => cancelled || leaseLost,
        }) as unknown as SiteMap
      : await runSiteExplorer({
          url: startUrl,
          depth,
          maxPages,
          writeSiteMap: true,
          outputDir: workspace.dir,
          onProgress: progress,
          shouldStop: () => cancelled || leaseLost,
        });
    await ensureActive();

    const thinThreshold = Math.max(3, Math.ceil(maxPages * 0.3));
    if (siteMap.total_pages <= thinThreshold) {
      progress(`Only ${siteMap.total_pages} page(s) found from links; trying safe navigation clicks.`);
      const broad = await runBroadClickExplorer({
        startUrl,
        authFile,
        existingSiteMap: siteMap,
        onProgress: progress,
        shouldStop: () => cancelled || leaseLost,
      });
      if (broad.discoveredPages.length > 0) {
        siteMap = {
          ...siteMap,
          pages: [...siteMap.pages, ...(broad.discoveredPages as unknown as SiteMap['pages'])],
          total_pages: siteMap.total_pages + broad.discoveredPages.length,
        };
      }
      await ensureActive();
    }

    if (session.contextDoc) {
      const comparison = compareCrawlToDocs(siteMap, session.contextDoc);
      const navigable = comparison.missing.filter(feature =>
        /\(\/[a-zA-Z0-9\-_./?]+\)|\b(page|screen|view|dashboard|panel|form|module|list|detail|editor|settings|profile|home|landing)\b/i.test(feature),
      );
      if (navigable.length > 0) {
        progress(`Trying documentation-guided navigation for ${navigable.length} missing feature(s).`);
        const guided = await runNavClickExplorer({
          startUrl,
          authFile,
          missingFeatures: navigable,
          existingSiteMap: siteMap,
          onProgress: progress,
          shouldStop: () => cancelled || leaseLost,
        });
        if (guided.discoveredPages.length > 0) {
          siteMap = {
            ...siteMap,
            pages: [...siteMap.pages, ...(guided.discoveredPages as unknown as SiteMap['pages'])],
            total_pages: siteMap.total_pages + guided.discoveredPages.length,
          };
        }
        await ensureActive();
      }
    }

    workspace.writeSiteMap(siteMap);
    await prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'idle',
        siteMap: siteMap as unknown as Prisma.InputJsonValue,
        pagesCount: siteMap.total_pages,
        error: null,
      },
    });
    return { pages: siteMap.total_pages, startUrl: siteMap.start_url };
  } finally {
    clearInterval(cancellationTimer);
    await eventChain.catch(() => undefined);
  }
}
