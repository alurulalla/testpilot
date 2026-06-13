/**
 * Coverage gap analysis for imported Playwright projects.
 *
 * POST: Crawls the site, compares against the imported tests, identifies gaps.
 * PATCH: Updates the user's selectedGapIds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import path from 'path';
import { getSessionDir } from '@/lib/config';
import {
  getSession, setStatus, setSiteMap, addLog, setCoverageAnalysis, updateSession,
} from '@/lib/session-store';
import { Workspace, runSiteExplorer } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { analyzeCoverageGaps } from '@/lib/analyze-coverage-gaps';
import { runAuthenticatedSiteExplorer } from '@/lib/authenticated-site-explorer';
import { getUrlContext } from '@/lib/url-context-store';
import { performPreLogin } from '@/lib/pre-login';
import { } from '@/lib/config';
import { getOrgSettings } from '@/lib/org-settings';
import { existsSync } from 'fs';
import type { SiteMap } from '@/types/session';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!session.importedProject) {
    return NextResponse.json({ error: 'No imported project — upload a Playwright ZIP first.' }, { status: 400 });
  }
  if (['exploring', 'analyzing', 'generating', 'running', 'fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session is busy' }, { status: 409 });
  }

  // Fire-and-forget async — client watches via SSE stream
  (async () => {
    try {
      const llmConfig  = await getOrgLlmConfig(session.orgId);
      const baseModel  = await createModelFromConfig(llmConfig);
      const chatModel  = withRateLimit(baseModel);
      const rootDir    = getSessionDir(id, session.orgId);
      const workspace  = new Workspace({ url: session.url, rootDir });
      workspace.init();
      const maxPages   = session.maxPages ?? 10;

      // ── Phase: Explore ───────────────────────────────────────────────────────
      setStatus(id, 'exploring');
      addLog(id, 'Crawling site to discover all features…', 'info');

      let siteMap: SiteMap;
      const urlCtx = await getUrlContext(session.url, session.orgId);
      let authFile: string | null = null;

      if (urlCtx?.fields.some(f => f.value)) {
        const loginResult = await performPreLogin(
          session.url, urlCtx.fields, workspace.dir,
          (line) => addLog(id, line, 'info'),
        );
        if (loginResult.success) {
          authFile = loginResult.authFile;
          addLog(id, 'Pre-login succeeded for crawl.', 'success');
        }
      }

      if (authFile && existsSync(authFile)) {
        siteMap = await runAuthenticatedSiteExplorer({
          url: session.url, authFile,
          depth: 3, maxPages: (await getOrgSettings(session.orgId)).deepCrawlMaxPages,
          outputDir: workspace.dir,
        }) as SiteMap;
      } else {
        siteMap = await runSiteExplorer({
          url: session.url, depth: 2, maxPages,
          outputDir: workspace.dir,
        }) as SiteMap;
      }

      setSiteMap(id, siteMap);
      addLog(id, `Crawled ${siteMap.total_pages} page(s). Analysing coverage gaps…`, 'success');

      // ── Phase: Analyse ───────────────────────────────────────────────────────
      setStatus(id, 'analyzing');
      const useCases = session.importedProject?.useCases ?? [];
      const gaps = await analyzeCoverageGaps(
        siteMap, useCases, chatModel,
        (line) => addLog(id, line, 'info'),
      );

      const totalFeatures = siteMap.pages.length;
      const coveredCount  = Math.max(0, totalFeatures - gaps.length);

      setCoverageAnalysis(id, {
        gaps,
        selectedGapIds: gaps.map(g => g.id), // all selected by default
        coveredCount,
        totalFeatures,
        analyzedAt: Date.now(),
      });

      addLog(
        id,
        gaps.length === 0
          ? '✅ Existing tests appear to cover all discovered features.'
          : `Found ${gaps.length} gap(s) across ${totalFeatures} feature(s). Review and select which to generate.`,
        gaps.length === 0 ? 'success' : 'info',
      );

      setStatus(id, 'idle');
    } catch (err) {
      addLog(id, `Gap analysis error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setStatus(id, 'idle');
    }
  })();

  return NextResponse.json({ ok: true });
}

/** Update which gap IDs the user has selected for generation. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!session.coverageAnalysis) {
    return NextResponse.json({ error: 'No analysis yet' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as { selectedGapIds?: string[] };
  if (!Array.isArray(body.selectedGapIds)) {
    return NextResponse.json({ error: 'selectedGapIds must be an array' }, { status: 400 });
  }

  setCoverageAnalysis(id, { ...session.coverageAnalysis, selectedGapIds: body.selectedGapIds });
  return NextResponse.json({ ok: true });
}
