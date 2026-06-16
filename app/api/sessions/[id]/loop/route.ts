import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import {
  getSession, getCachedSession, setStatus, setSiteMap, setTestResult, setFixResult,
  setTriageResult, setFigmaResult, setFigmaChecking, setError, clearError,
  addLog, updateSession, isStopping, clearStopping, subscribe, unsubscribe,
} from '@/lib/session-store';

import { runSiteExplorer, runGenerateSuite, Workspace } from '@/lib/pilot';
import { reviewGeneratedTests } from '@/lib/review-tests';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig, getOrgFigmaToken } from '@/lib/llm-config-store';
import { runTestsAsync } from '@/lib/run-tests-async';
import { fixTestsPerFile, fixSyntaxErrors } from '@/lib/fix-tests-per-file';
import { healWithAgent } from '@/lib/heal-agent';
import { triageFailures } from '@/lib/triage-failures';
import { SiteMap } from '@/types/session';
import { withRateLimit } from '@/lib/rate-limited-model';
import { getUrlContext, saveUrlContext, contextToEnv, contextToPromptHint } from '@/lib/url-context-store';
import { getSessionDir } from '@/lib/config';
import { getOrgSettings } from '@/lib/org-settings';
import { runFigmaComparison, isFigmaConfigured } from '@/lib/figma-client';
import { extractCredentialsFromDoc } from '@/lib/extract-credentials-from-doc';
import { performPreLogin } from '@/lib/pre-login';
import { runAuthenticatedSiteExplorer } from '@/lib/authenticated-site-explorer';
import { writeContextMd } from '@/lib/build-context-md';
import { compareCrawlToDocs } from '@/lib/compare-crawl-to-docs';
import { runNavClickExplorer, runBroadClickExplorer } from '@/lib/pilot/nav-click-explorer';
import { discoverSelectors } from '@/lib/pilot/discover-selectors';
import { synthesizeFeatures } from '@/lib/synthesize-features';
import { ensureAppProfile, hostOf, appProfileExists, mergeDiscoveredFeatures, tagTestsToFeatures } from '@/lib/app-profile';
import { withTokenCounter, withStopCheck, StopError } from '@/lib/token-counter';
import { getFeatureContext } from '@/lib/feature-context';
import { snapshotTestFiles } from '@/lib/session-files';
import { findPriorSuite, copySuiteInto, currentFeatureNames } from '@/lib/suite-reuse';
import { recordTestRun, attachTriageToRun, attachFixToRun } from '@/lib/test-runs';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { prisma } from '@/lib/prisma';
import path from 'path';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { maxIterations?: number };
  // Default lowered 5 → 3: most healing converges in 1–2 passes, and the
  // no-progress guard stops earlier — fewer wasted triage/heal cycles (tokens).
  const maxIterations = body.maxIterations ?? 3;
  const maxPages = session.maxPages ?? 10;
  // Note: headedMode is intentionally NOT captured here — it is read fresh from the
  // session store before each test run so the user can toggle it during exploration/generation.

  // ── SSE stream ─────────────────────────────────────────────────────────────
  const enc = new TextEncoder();
  let streamCtrl!: ReadableStreamDefaultController;

  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const responseStream = new ReadableStream({
    start(ctrl) {
      streamCtrl = ctrl;
      subscribe(id, ctrl);
      // getCachedSession is safe here — await getSession(id) above populated the cache.
      const s = getCachedSession(id);
      if (s) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'init', session: s })}\n\n`));

      // Ping every 15 s — under Vercel edge's ~30 s idle-connection limit.
      heartbeat = setInterval(() => {
        try { ctrl.enqueue(enc.encode(': ping\n\n')); } catch { /* stream closed */ }
      }, 15_000);
    },
    cancel() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      try { unsubscribe(id, streamCtrl); } catch { /* already closed */ }
    },
  });

  addLog(id, `Starting full loop (max ${maxIterations} iterations)…`, 'info');

  (async () => {
    clearStopping(id);
    clearError(id); // drop any error from a previous (e.g. missing-key) run

    const stopped = (phase?: string): boolean => {
      if (!isStopping(id)) return false;
      addLog(id, phase ? `Stopped by user (after ${phase}).` : 'Stopped by user.', 'info');
      setStatus(id, 'idle');
      clearStopping(id);
      return true;
    };

    try {
      const rootDir = getSessionDir(id, session.orgId);
      const workspace = new Workspace({ url: session.url, rootDir });
      workspace.init();

      // Phase 0: Pre-login
      const orgId = getCachedSession(id)?.orgId ?? session.orgId;
      const docForExtraction = getCachedSession(id)?.contextDoc ?? null;
      if (docForExtraction && !(await getUrlContext(session.url, orgId))?.fields.some(f => f.value)) {
        const extracted = extractCredentialsFromDoc(docForExtraction);
        if (extracted) {
          addLog(id, `📋 Found credentials in product documentation (${extracted.usernameLabel}: ${extracted.username}) — saving for pre-login.`, 'info');
          await saveUrlContext(session.url, [
            { key: 'username', label: extracted.usernameLabel, type: 'text',     value: extracted.username, sensitive: false },
            { key: 'password', label: 'Password',              type: 'password', value: extracted.password, sensitive: true  },
          ], orgId);
        }
      }

      const urlCtx = await getUrlContext(session.url, orgId);
      let exploreStartUrl = session.url;
      let authFile: string | null = null;

      if (urlCtx && urlCtx.fields.some(f => f.value)) {
        addLog(id, 'Context detected — attempting pre-login before exploration…', 'info');
        const loginResult = await performPreLogin(
          session.url,
          urlCtx.fields,
          workspace.dir,
          (line) => addLog(id, line, 'info'),
        );
        if (loginResult.success) {
          try {
            const parsed = new URL(loginResult.postLoginUrl);
            exploreStartUrl = parsed.origin + parsed.pathname;
          } catch {
            exploreStartUrl = loginResult.postLoginUrl;
          }
          authFile = loginResult.authFile;
          addLog(id, `Pre-login succeeded. Exploration will start from: ${exploreStartUrl}`, 'success');

          if (loginResult.loginPageInfo) {
            const { url: loginUrl, usernameSelector, submitButtonText } = loginResult.loginPageInfo;
            const loginEnv =
              `TESTPILOT_LOGIN_URL=${loginUrl}\n` +
              `TESTPILOT_LOGIN_USERNAME_SELECTOR=${usernameSelector}\n` +
              `TESTPILOT_LOGIN_SUBMIT_TEXT=${submitButtonText}\n`;
            const envPath = path.join(rootDir, workspace.slug, '.env');
            const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
            const toAdd = loginEnv.split('\n')
              .filter(l => l && !existingEnv.includes(l.split('=')[0] + '='))
              .join('\n');
            if (toAdd) writeFileSync(envPath, existingEnv + (existingEnv.endsWith('\n') ? '' : '\n') + toAdd + '\n', 'utf8');
          }
        } else {
          addLog(id, `Pre-login failed: ${loginResult.error ?? 'unknown error'}. Exploring from the original URL.`, 'error');
        }
      }

      const llmConfig = await getOrgLlmConfig(session.orgId);
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withTokenCounter(withStopCheck(withRateLimit(baseModel), () => isStopping(id)));
      await workspace.installDeps();

      // ── Imported project fast path ──────────────────────────────────────────
      const isImportMode = Boolean(getCachedSession(id)?.importedProject) && workspace.testFiles().length > 0;
      // App-context spine (Phase 2): set after the profile is built (crawl path),
      // then injected into generation/triage/self-heal in the iteration loop below.
      let appContext = '';
      // Stable host derived early so the Figma comparison (Phase 1.8) can tie
      // frames back to features (#9) before the profile is rebuilt.
      const appHost = hostOf(session.url);

      if (isImportMode) {
        addLog(id, '📦 Imported Playwright project — skipping exploration and generation, running existing tests.', 'info');
        if (!getCachedSession(id)?.siteMap) {
          setSiteMap(id, {
            start_url: session.url,
            total_pages: 1,
            pages: [{ url: session.url, depth: 0, title: 'Imported project', status_code: 200, elements: {}, child_urls: [], screenshot: '', error: null }],
          } as SiteMap);
        }
        updateSession(id, { testFiles: workspace.testFiles() });
        await snapshotTestFiles(id, workspace);
        addLog(id, `${workspace.testFiles().length} imported test file(s) ready.`, 'success');
      } else {

      // Phase 1: Explore
      setStatus(id, 'exploring');
      const isAuthenticatedCrawl = Boolean(authFile && existsSync(authFile));
      const crawlMaxPages  = isAuthenticatedCrawl ? (await getOrgSettings(session.orgId)).deepCrawlMaxPages : maxPages;
      const crawlDepth     = isAuthenticatedCrawl ? 3 : 2;

      if (isAuthenticatedCrawl) {
        addLog(id, `Phase 1: Deep authenticated crawl (up to ${crawlMaxPages} pages, depth ${crawlDepth})…`, 'info');
      } else {
        addLog(id, 'Phase 1: Exploring site…', 'info');
      }

      let siteMap: SiteMap;
      if (isAuthenticatedCrawl) {
        addLog(id, 'Using authenticated browser for site exploration…', 'info');
        siteMap = await runAuthenticatedSiteExplorer({
          url: exploreStartUrl,
          authFile: authFile!,
          depth: crawlDepth,
          maxPages: crawlMaxPages,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
          shouldStop: () => isStopping(id),
        }) as unknown as SiteMap;
      } else {
        siteMap = await runSiteExplorer({
          url: exploreStartUrl,
          depth: crawlDepth,
          maxPages: crawlMaxPages,
          writeSiteMap: true,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
          shouldStop: () => isStopping(id),
        });
      }
      setSiteMap(id, siteMap as unknown as SiteMap);
      addLog(id, `Found ${siteMap.total_pages} page(s).`, 'success');
      if (stopped('explore')) return;

      // Phase 1.4: Broad click discovery (doc-free). When the plain link crawl
      // found suspiciously few pages, the site is likely a button-driven SPA —
      // click through nav/menu/tab elements to reveal pages that have no <a href>.
      {
        const thinThreshold = Math.max(3, Math.ceil(crawlMaxPages * 0.3));
        if (siteMap.total_pages <= thinThreshold) {
          addLog(id, `Phase 1.4: Only ${siteMap.total_pages} page(s) from links — trying button/menu navigation…`, 'info');
          try {
            const broad = await runBroadClickExplorer({
              startUrl: exploreStartUrl,
              authFile: authFile ?? undefined,
              existingSiteMap: siteMap,
              onProgress: (line) => addLog(id, line, 'info'),
              shouldStop: () => isStopping(id),
            });
            if (broad.discoveredPages.length > 0) {
              const merged: SiteMap = {
                ...siteMap,
                pages:       [...siteMap.pages, ...(broad.discoveredPages as unknown as SiteMap['pages'])],
                total_pages: siteMap.total_pages + broad.discoveredPages.length,
              };
              siteMap = merged;
              setSiteMap(id, merged as unknown as SiteMap);
              workspace.writeSiteMap(merged);
              addLog(id, `  ✓ Click discovery added ${broad.discoveredPages.length} page(s).`, 'success');
            } else {
              addLog(id, '  Phase 1.4: no additional pages found via clicking.', 'info');
            }
          } catch (e) {
            addLog(id, `  Phase 1.4 error (non-fatal): ${e instanceof Error ? e.message : String(e)}`, 'info');
          }
          if (stopped('click discovery')) return;
        }
      }

      // Phase 1.8: Figma design verification — fire-and-forget in parallel.
      {
        const figmaSession = getCachedSession(id);
        const figmaToken = await getOrgFigmaToken(session.orgId);
        if (figmaSession?.figmaFileUrl && !figmaSession.figmaChecking && isFigmaConfigured(figmaToken, figmaSession.figmaFileUrl)) {
          setFigmaChecking(id, true);
          addLog(id, '🎨 Phase 1.8: Figma design verification starting (parallel with test generation)…', 'info');
          const knownUrls = (siteMap.pages as Array<{ url: string }>).map(p => p.url);
          runFigmaComparison(
            figmaToken!,
            figmaSession.figmaFileUrl,
            session.url,
            workspace.dir,
            knownUrls,
            (line) => addLog(id, line, 'info'),
            chatModel,
            figmaSession.figmaFrameMap,
            { orgId: session.orgId, host: appHost }, // #9 — tie frames to features
          ).then(async result => {
            setFigmaResult(id, result);
            // Surface the per-frame figma specs in the main suite + persist them.
            try {
              updateSession(id, { testFiles: workspace.testFiles() });
              await snapshotTestFiles(id, workspace);
            } catch { /* non-fatal */ }
            const totalIssues = result.comparisons.reduce((n, c) => n + (c.discrepancies?.length ?? 0), 0);
            const scoredComparisons = result.comparisons.filter(c => c.matchScore != null);
            const avgScore = scoredComparisons.length > 0
              ? Math.round(scoredComparisons.reduce((n, c) => n + c.matchScore!, 0) / scoredComparisons.length)
              : 0;
            addLog(
              id,
              `🎨 Figma verification complete — ${result.comparisons.length} frame(s), ${totalIssues} issue(s), avg match ${avgScore}/100.`,
              totalIssues === 0 ? 'success' : 'info',
            );
          }).catch(err => {
            addLog(id, `🎨 Figma verification failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
          }).finally(() => {
            setFigmaChecking(id, false);
          });
        }
      }

      // Phase 1.5: Compare crawled content against product documentation
      const freshDocSession = getCachedSession(id);
      if (freshDocSession?.contextDoc) {
        try {
          const docComparison = compareCrawlToDocs(siteMap, freshDocSession.contextDoc);
          if (docComparison.total > 0) {
            addLog(id, `Phase 1.5: Comparing crawl against documentation (${docComparison.total} feature(s))…`, 'info');
            if (docComparison.covered.length > 0) {
              addLog(id, `  ✓ ${docComparison.covered.length} feature(s) confirmed in crawl: ${docComparison.covered.slice(0, 5).join(', ')}${docComparison.covered.length > 5 ? '…' : ''}`, 'success');
            }
            if (docComparison.missing.length > 0) {
              addLog(
                id,
                `  ⚠ ${docComparison.missing.length} feature(s) from docs not found in crawl` +
                (isAuthenticatedCrawl ? '' : ' — these may be behind authentication') +
                `: ${docComparison.missing.join(', ')}`,
                'info',
              );
              if (!isAuthenticatedCrawl && docComparison.missing.length > 0) {
                addLog(id, '  💡 Tip: Add login credentials on the prepare page to enable a deeper authenticated crawl.', 'info');
              }

              // Phase 1.6: Doc-guided click navigation
              const navigableFeatures = docComparison.missing.filter(f => {
                const lower = f.toLowerCase();
                if (/\(\/[a-zA-Z0-9\-_./?]+\)/.test(f)) return true;
                if (/\b(page|screen|view|dashboard|panel|form|module|list|detail|editor|settings|profile|home|landing)\b/i.test(f)) return true;
                const docOnly = ['credential', 'persona', 'scenario', 'path', 'limitation',
                  'reference', 'selector', 'suitability', 'regression', 'performance', 'automation'];
                if (docOnly.some(kw => lower.includes(kw))) return false;
                return false;
              });

              if (navigableFeatures.length === 0) {
                addLog(id, 'Phase 1.6: No navigable page features to attempt — skipping click navigation.', 'info');
              } else {
              addLog(id, `Phase 1.6: Attempting to reach ${navigableFeatures.length} page feature(s) via navigation clicks…`, 'info');
              try {
                const clickResult = await runNavClickExplorer({
                  startUrl:        exploreStartUrl,
                  authFile:        authFile ?? undefined,
                  missingFeatures: navigableFeatures,
                  existingSiteMap: siteMap,
                  onProgress:      (line) => addLog(id, line, 'info'),
                  shouldStop:      () => isStopping(id),
                });

                if (clickResult.discoveredPages.length > 0) {
                  const merged: SiteMap = {
                    ...siteMap,
                    pages:       [...siteMap.pages, ...(clickResult.discoveredPages as unknown as SiteMap['pages'])],
                    total_pages: siteMap.total_pages + clickResult.discoveredPages.length,
                  };
                  siteMap = merged;
                  setSiteMap(id, merged as unknown as SiteMap);
                  workspace.writeSiteMap(merged);
                  addLog(
                    id,
                    `  ✓ Click-nav found ${clickResult.discoveredPages.length} new page(s) for: ${clickResult.foundFeatures.join(', ')}`,
                    'success',
                  );
                }
                if (clickResult.missedFeatures.length > 0) {
                  addLog(
                    id,
                    `  ○ Still not reachable via navigation: ${clickResult.missedFeatures.join(', ')}`,
                    'info',
                  );
                }
              } catch (clickErr) {
                addLog(id, `  Phase 1.6 click-nav error (non-fatal): ${clickErr instanceof Error ? clickErr.message : String(clickErr)}`, 'error');
              }
              }
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (stopped('doc comparison')) return;

      // Phase 1.75: LLM Selector Discovery
      const sessionForDiscovery = getCachedSession(id);
      if (sessionForDiscovery?.contextDoc) {
        try {
          addLog(id, 'Phase 1.75: LLM selector discovery…', 'info');
          const selectorMaps = await discoverSelectors({
            siteMap: siteMap as unknown as Parameters<typeof discoverSelectors>[0]['siteMap'],
            contextMd: sessionForDiscovery.contextDoc,
            model: chatModel,
            onProgress: (line) => addLog(id, line, 'info'),
          });
          if (selectorMaps.length > 0) {
            workspace.writeSelectorHints(selectorMaps);
            addLog(id, `  ✓ Selector hints written for ${selectorMaps.length} page/feature pair(s)`, 'success');
          } else {
            addLog(id, '  Phase 1.75: no selector hints produced (pages may not match doc features)', 'info');
          }
        } catch (err) {
          addLog(
            id,
            `  Phase 1.75 error (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            'error',
          );
        }
      }

      if (stopped('selector discovery')) return;

      // Phase 1.9: Feature synthesis (ALWAYS) — turn the crawl into a structured
      // list of user-facing features/flows. Merges with any user-defined flows.
      // Output (features.json) is injected into generation as a coverage checklist.
      addLog(id, 'Phase 1.9: Synthesizing features from crawl…', 'info');
      // Captured for Phase 4 drift detection (fold new capabilities into the profile).
      let discoveredFeatures: { name: string; description: string; steps?: string[] }[] = [];
      try {
        const sessForFeat = getCachedSession(id);
        const docFeatureNames = (sessForFeat?.userFlows ?? []).map(f => f.title).filter(Boolean);
        const features = await synthesizeFeatures({
          siteMap: siteMap as unknown as Parameters<typeof synthesizeFeatures>[0]['siteMap'],
          model: chatModel,
          docFeatureNames,
          onProgress: (line) => addLog(id, line, 'info'),
        });
        discoveredFeatures = features;
        if (features.length > 0) {
          workspace.writeFeatures(features);
          addLog(id, `  ✓ Identified ${features.length} feature(s)/flow(s).`, 'success');
        } else {
          addLog(id, '  Phase 1.9: no features synthesized (crawl may be too thin).', 'info');
        }
      } catch (e) {
        addLog(id, `  Phase 1.9 error (non-fatal): ${e instanceof Error ? e.message : String(e)}`, 'info');
      }
      if (stopped('feature synthesis')) return;

      // Phase 1.95: Build the App Profile (feature-context spine) once per app.
      // Deterministic signals + one LLM pass → purpose/personas/glossary/features,
      // persisted per org+host and reused. `appContext` (a compact slice) is then
      // injected into generation / triage / self-heal below.
      try {
        const profileExisted = await appProfileExists(session.orgId, appHost);
        // Figma screen names feed the profile synthesis (design intent). The
        // profile auto-rebuilds when the doc, figma, or crawl size changes.
        const frameMap = (getCachedSession(id)?.figmaFrameMap ?? null) as Record<string, string> | null;
        const figmaContext = frameMap && Object.keys(frameMap).length
          ? `Figma screens: ${Object.keys(frameMap).join(', ')}`
          : null;
        await ensureAppProfile({
          orgId: session.orgId,
          host: appHost,
          siteMap,
          docContent: getCachedSession(id)?.contextDoc ?? null,
          figmaContext,
          model: chatModel,
          onProgress: (line) => addLog(id, line, 'info'),
        });
        // Phase 4 write-back (self-improving loop):
        // (a) DRIFT — on subsequent crawls, fold newly-discovered capabilities into
        //     the existing profile as proposals for review (skip the build run to
        //     avoid duplicating what the build just synthesized).
        if (profileExisted && discoveredFeatures.length) {
          const added = await mergeDiscoveredFeatures(session.orgId, appHost, discoveredFeatures);
          if (added > 0) addLog(id, `  ↳ ${added} new feature(s) proposed from this crawl (review in Profile).`, 'info');
        }
        // (b) TAGGING — link stored tests to features (area → featureId). Covers
        //     generated AND recorded tests once they have a use-case description.
        const tagged = await tagTestsToFeatures(session.orgId, appHost);
        if (tagged > 0) addLog(id, `  ↳ Tagged ${tagged} test(s) to their feature.`, 'info');

        appContext = await getFeatureContext(session.orgId, appHost);
      } catch (e) {
        addLog(id, `  App profile build skipped (non-fatal): ${e instanceof Error ? e.message : String(e)}`, 'info');
      }
      if (stopped('app profile')) return;

      // Phase 2: Generate
      setStatus(id, 'generating');
      addLog(id, 'Phase 2: Generating tests…', 'info');

      const freshSession = getCachedSession(id);
      const hasDoc      = Boolean(freshSession?.contextDoc);
      const hasFlows    = (freshSession?.userFlows?.length ?? 0) > 0;
      const hasImported = Boolean(freshSession?.importedProject);

      if (hasDoc || hasFlows || hasImported) {
        const importedLog = hasImported
          ? `, ${freshSession!.importedProject!.useCases.reduce((n, u) => n + u.tests.length, 0)} imported test case(s)`
          : '';
        addLog(id, `Writing context to workspace (${freshSession!.contextDoc?.length ?? 0} chars, ${freshSession!.userFlows?.length ?? 0} flow(s)${importedLog})…`, 'info');
        writeContextMd(
          workspace.dir,
          freshSession!.contextDoc ?? null,
          freshSession!.userFlows ?? [],
          freshSession!.importedProject ?? null,
        );
      }

      if (urlCtx && urlCtx.fields.some(f => f.value)) {
        addLog(id, `Injecting context: ${urlCtx.fields.filter(f => f.value).length} field(s) configured.`, 'info');

        const envVars = contextToEnv(urlCtx);
        const envPath = path.join(workspace.dir, '.env');
        const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        const newEntries = Object.entries(envVars)
          .filter(([k]) => !existingEnv.includes(k + '='))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n');
        if (newEntries) {
          writeFileSync(envPath, existingEnv + (existingEnv.endsWith('\n') ? '' : '\n') + newEntries + '\n', 'utf8');
        }

        const hint = contextToPromptHint(urlCtx);
        if (hint) {
          const contextPath = path.join(workspace.dir, 'CONTEXT.md');
          const existing = existsSync(contextPath) ? readFileSync(contextPath, 'utf8').trimEnd() : '';
          const section = '\n\n---\n\n# Test Credentials & Context\n\n' + hint;
          writeFileSync(contextPath, (existing || '') + section + '\n', 'utf8');
        }
      }

      // ── Token saver: reuse a prior suite when the app hasn't gained features ──
      // Only for pure crawl-driven sessions (no doc/flows/import — those change
      // what we'd generate). If a previous session tested the same app and the
      // crawl surfaced no NEW features, copy that suite instead of regenerating.
      let reusedSuite = false;
      if (!hasDoc && !hasFlows && !hasImported) {
        const prior = await findPriorSuite(session.orgId, session.url, id);
        if (prior) {
          const current = currentFeatureNames(workspace);
          const priorSet = new Set(prior.featureNames);
          const newFeatures = current.filter(n => !priorSet.has(n));
          if (current.length > 0 && prior.featureNames.length > 0 && newFeatures.length === 0) {
            addLog(
              id,
              `♻ Reusing the existing suite for this app — no new features detected since the last run, ` +
              `so ${prior.specCount} spec file(s) were copied instead of regenerating (0 tokens spent on generation).`,
              'success',
            );
            await copySuiteInto(id, workspace, prior.files);
            updateSession(id, { testFiles: workspace.testFiles() });
            await snapshotTestFiles(id, workspace);
            reusedSuite = true;
          } else if (newFeatures.length > 0) {
            addLog(
              id,
              `🔎 ${newFeatures.length} new feature(s) since the last suite (${newFeatures.slice(0, 5).join(', ')}${newFeatures.length > 5 ? '…' : ''}) — regenerating.`,
              'info',
            );
          }
        }
      }

      if (!reusedSuite) {
        const origLog = console.log;
        console.log = (...args: unknown[]) => {
          origLog(...args);
          const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
          addLog(id, msg, msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') ? 'error' : 'info');
        };
        try {
          await runGenerateSuite({
            skipExplore: true,
            depth: 2,
            maxPages,
            model: llmConfig.model,
            chatModel,
            workspace,
            appContext,
            shouldStop: () => isStopping(id),
          });
        } finally {
          console.log = origLog;
        }
        const testFiles = workspace.testFiles();
        updateSession(id, { testFiles });
        await snapshotTestFiles(id, workspace); // durable copy in DB (survives redeploy)
        addLog(id, `Generated ${testFiles.length} test file(s).`, 'success');
      }
      if (stopped('generate')) return;

      // Phase 2.5: Review generated tests
      addLog(id, 'Phase 2.5: Reviewing generated tests against crawled elements…', 'info');
      try {
        const reviewResult = await reviewGeneratedTests(
          workspace,
          chatModel,
          (line) => addLog(id, line, 'info'),
        );
        if (reviewResult.fixed > 0) {
          addLog(id, `Review complete — corrected ${reviewResult.fixed} of ${reviewResult.reviewed} file(s).`, 'success');
          updateSession(id, { testFiles: workspace.testFiles() });
          await snapshotTestFiles(id, workspace);
        } else {
          addLog(id, `Review complete — all ${reviewResult.reviewed} file(s) passed locator check.`, 'success');
        }
      } catch (reviewErr) {
        addLog(id, `Phase 2.5 review error (non-fatal): ${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}`, 'error');
      }
      if (stopped('review')) return;

      } // end !isImportMode

      // Phase 3-N: Run → Triage → (optionally) Fix loop
      // Track the last syntax-error signature so a non-advancing "fix → same
      // error → re-run" cycle can't spin forever (e.g. an error in a file the
      // healer can't reach). See the errors>0 && total===0 branch below.
      let lastSyntaxSig: string | null = null;
      let syntaxAttempts = 0;
      let prevFailSig = ''; // failures from the previous iteration (no-progress guard)
      for (let i = 1; i <= maxIterations; i++) {
        if (stopped()) return;
        updateSession(id, { iteration: i });
        setStatus(id, 'running');
        setTriageResult(id, null);
        addLog(id, `Iteration ${i}: Running tests…`, 'info');
        // Read headedMode fresh so toggling during explore/generate is respected
        const headed = getCachedSession(id)?.headedMode ?? false;
        const result = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, headed);
        setTestResult(id, result);
        const runId = await recordTestRun(id, result, { trigger: 'loop', iteration: i + 1 });
        if (stopped('test run')) return;

        const { passed, failed, total, errors } = result.stats;
        if (errors > 0 && total === 0) {
          const isInfraError =
            result.output.includes('command not found') ||
            result.output.includes('Cannot find module') ||
            result.output.includes('MODULE_NOT_FOUND') ||
            result.output.includes('ENOENT') ||
            result.output.includes('Executable doesn\'t exist') ||
            result.output.includes('browserType.launch');
          if (isInfraError) {
            addLog(id, `Test runner infrastructure error — cannot auto-heal:\n${result.output.slice(0, 500)}`, 'error');
            break;
          }

          // No-progress guard: if the SAME compile error survives a heal attempt,
          // stop instead of looping (the previous endless-loop failure mode).
          const errSig = result.output
            .split('\n')
            .filter(l => /SyntaxError|has already been declared|Identifier|No tests found|ReferenceError|TypeError|Cannot find/.test(l))
            .join('|')
            .slice(0, 600);
          if (errSig && errSig === lastSyntaxSig) {
            addLog(id, `Auto-heal made no progress — the same error persists after a fix attempt. Stopping to avoid an endless loop.\n${result.output.slice(0, 600)}`, 'error');
            break;
          }
          lastSyntaxSig = errSig;
          if (++syntaxAttempts > 4) {
            addLog(id, 'Exceeded auto-heal attempts for syntax/compile errors — stopping.', 'error');
            break;
          }

          addLog(id, 'Test run failed — syntax error or no tests found. Attempting auto-heal…', 'error');
          setStatus(id, 'fixing');
          const syntaxFixed = await fixSyntaxErrors(
            workspace,
            result.output,
            chatModel,
            (line) => addLog(id, line, 'info'),
          ).catch(() => false);
          if (!syntaxFixed) {
            addLog(id, 'Could not auto-heal syntax errors. Stopping.', 'error');
            break;
          }
          addLog(id, 'Syntax errors fixed — retrying tests…', 'success');
          updateSession(id, { testFiles: workspace.testFiles() });
          await snapshotTestFiles(id, workspace);
          i -= 1;
          continue;
        }
        addLog(id, `${passed}/${total} passed, ${failed} failed.`, failed === 0 ? 'success' : 'error');

        if (failed === 0) {
          addLog(id, 'All tests passing! Loop complete.', 'success');
          break;
        }

        // Token/time guard: if the EXACT same tests fail as last iteration, the
        // previous heal pass changed nothing — more triage+heal cycles will just
        // burn tokens. Stop here. (Remaining failures are app bugs or stuck tests.)
        const failSig = Object.entries(result.cases ?? {})
          .filter(([, s]) => s === 'failed').map(([k]) => k).sort().join('|');
        if (i > 1 && failSig && failSig === prevFailSig) {
          addLog(id, `Auto-heal made no progress since the last iteration (${failed} failure(s) unchanged) — stopping to save time and tokens.`, 'info');
          break;
        }
        prevFailSig = failSig;

        // Triage failures
        addLog(id, `Iteration ${i}: Analysing failures…`, 'info');
        const triage = await triageFailures(
          workspace,
          getCachedSession(id)?.contextDoc ?? null,
          getCachedSession(id)?.url ?? session.url,
          chatModel,
          (line) => addLog(id, line, 'info'),
          appContext,
        ).catch(() => null);
        if (stopped('triage')) return;

        if (triage) {
          setTriageResult(id, triage);
          await attachTriageToRun(runId, triage);
          if (triage.dominantRootCause) {
            addLog(id, `▶ Root cause: ${triage.dominantRootCause}`, 'error');
          }
          if ((triage.setupErrorCount ?? 0) > 0) {
            addLog(
              id,
              `⚠ ${triage.setupErrorCount} failure(s) are setup/auth errors — fix credentials or login selectors; tests can't pass until login works. Skipping self-heal for these.`,
              'error',
            );
          }
          if (triage.appBugCount > 0) {
            addLog(
              id,
              `⚠ ${triage.appBugCount} failure(s) are application bugs — the app may not match its documentation.`,
              'error',
            );
          }
        }

        const { autoSelfHeal, healMode } = await getOrgSettings(session.orgId);

        if (!autoSelfHeal) {
          addLog(
            id,
            triage?.selfHealRecommended
              ? `Self-healing is available for ${(triage.testBugCount ?? 0) + (triage.ambiguousCount ?? 0)} test-code issue(s). Click "Self-Heal" to fix.`
              : 'No healable test-code issues found.',
            'info',
          );
          break;
        }

        if (!triage?.selfHealRecommended) {
          addLog(
            id,
            (triage?.setupErrorCount ?? 0) > 0
              ? 'Remaining failures are setup/auth or app issues — not auto-healable. Fix credentials/selectors and re-run. Stopping auto-heal loop.'
              : 'All remaining failures are application bugs. Stopping auto-heal loop.',
            'info',
          );
          break;
        }

        if (i < maxIterations) {
          if (stopped()) return;
          setStatus(id, 'fixing');
          let fixResult: { fixed: boolean; filesChanged: number };
          if (healMode === 'agent') {
            // E2: iterative observe→act→verify agent (opt-in via org settings).
            addLog(id, `Iteration ${i}: Self-heal agent fixing healable failures…`, 'info');
            const healable = (triage?.analyses ?? [])
              .filter(a => a.verdict !== 'app_bug' && a.verdict !== 'setup_error')
              .map(a => ({ file: a.file, title: a.testName, error: a.error }));
            const r = await healWithAgent({
              workspace, model: chatModel, failures: healable, appContext,
              sessionId: id, onProgress: (line) => addLog(id, line, 'info'),
            });
            fixResult = { fixed: r.fixed, filesChanged: r.filesChanged };
          } else {
            addLog(id, `Iteration ${i}: Auto-fixing healable failures…`, 'info');
            fixResult = await fixTestsPerFile(
              workspace, chatModel, (line) => addLog(id, line, 'info'), id, triage?.analyses, appContext,
            );
          }
          setFixResult(id, { fixed: fixResult.fixed, filesChanged: fixResult.filesChanged });
          await attachFixToRun(runId, { fixed: fixResult.fixed, filesChanged: fixResult.filesChanged });
          if (fixResult.fixed) await snapshotTestFiles(id, workspace); // persist healed content
          addLog(
            id,
            fixResult.fixed ? `Fixed ${fixResult.filesChanged} file(s).` : 'No fixes applied.',
            fixResult.fixed ? 'success' : 'info',
          );
          if (stopped('fix')) return;
          if (!fixResult.fixed) {
            addLog(id, 'No progress made, stopping early.', 'info');
            break;
          }
        }
      }

      setStatus(id, 'idle');
      // Persist token usage accumulated across all LLM calls in this session.
      const usage = chatModel.getUsage();
      if (usage.input > 0 || usage.output > 0) {
        const totalK = ((usage.input + usage.output) / 1000).toFixed(1);
        addLog(id, `🪙 LLM tokens used: ${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out · ${usage.cacheRead.toLocaleString()} cache-read (${totalK}k total)`, 'info');
        await prisma.session.update({ where: { id }, data: { tokenUsage: usage as object } }).catch(() => {});
      }
      addLog(id, '✅ Session complete.', 'success');
    } catch (err) {
      if (err instanceof StopError) {
        setStatus(id, 'idle');
        addLog(id, '⏹ Session stopped.', 'info');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(id, msg);
        addLog(id, `Loop failed: ${msg}`, 'error');
      }
    } finally {
      clearStopping(id);
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      try { unsubscribe(id, streamCtrl); streamCtrl.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
