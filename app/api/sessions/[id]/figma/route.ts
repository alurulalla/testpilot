import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { getSession, getCachedSession, setStatus, setFigmaResult, setFigmaChecking, setError, addLog, clearStopping, updateSession } from '@/lib/session-store';
import { snapshotTestFiles } from '@/lib/session-files';
import { runFigmaComparison, isFigmaConfigured } from '@/lib/figma-client';
import { getSessionDir } from '@/lib/config';
import { Workspace, createModelFromConfig } from '@/lib/pilot';
import { getOrgLlmConfig, getOrgFigmaToken } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import path from 'path';


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Reject only if Figma is already in progress — the main pipeline can run in parallel
  if (session.figmaChecking) {
    return NextResponse.json({ error: 'Figma verification already running' }, { status: 409 });
  }

  const token = await getOrgFigmaToken(session.orgId);
  if (!isFigmaConfigured(token, session.figmaFileUrl)) {
    return NextResponse.json(
      { error: 'Figma not configured — add a Figma token in Settings → AI → API Keys and a Figma URL to this session' },
      { status: 400 },
    );
  }

  // Mark Figma as in-progress (independent of the main pipeline status).
  // This lets Figma run in parallel with feature discovery / test execution.
  setFigmaChecking(id, true);
  // Only show the figma-checking badge when the pipeline is not already running
  const pipelineActive = ['exploring', 'analyzing', 'generating', 'running', 'fixing'].includes(session.status);
  if (!pipelineActive) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setStatus(id, 'figma-checking' as any);
  }
  addLog(id, 'Running Figma design verification…', 'info');

  (async () => {
    clearStopping(id);
    try {
      const workspace = new Workspace({
        url: session.url,
        rootDir: getSessionDir(id, session.orgId),
      });

      // Build LLM model for DOM comparison
      const llmConfig = await getOrgLlmConfig(session.orgId);
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);

      // Pass known site URLs from the site map so frames can be matched to real pages
      const knownUrls = session.siteMap?.pages.map(p => p.url) ?? [];

      const result = await runFigmaComparison(
        token!,
        session.figmaFileUrl!,
        session.url,
        workspace.dir,
        knownUrls,
        (line) => addLog(id, line, 'info'),
        chatModel,
        session.figmaFrameMap,
        { orgId: session.orgId, host: new URL(session.url).hostname.replace(/^www\./, '') },
      );

      setFigmaResult(id, result);
      // Surface the per-frame figma specs in the main suite + persist them.
      try {
        updateSession(id, { testFiles: workspace.testFiles() });
        await snapshotTestFiles(id, workspace);
      } catch { /* non-fatal */ }
      const totalIssues = result.comparisons.reduce(
        (n, c) => n + (c.discrepancies?.length ?? 0), 0,
      );
      // Only average scored comparisons — undefined means unreachable/unanalysed.
      const scoredComparisons = result.comparisons.filter(c => c.matchScore != null);
      const avgScore = scoredComparisons.length > 0
        ? Math.round(
            scoredComparisons.reduce((n, c) => n + c.matchScore!, 0) /
            scoredComparisons.length,
          )
        : 0;
      addLog(
        id,
        `Figma verification complete: ${result.comparisons.length} frame(s) analysed, ` +
        `${totalIssues} discrepancy(ies) found, avg match score ${avgScore}/100.`,
        totalIssues === 0 ? 'success' : 'info',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(id, `Figma comparison failed: ${msg}`, 'error');
      // Only escalate to session-level error when the pipeline is not running
      const sess = getCachedSession(id);
      if (sess && !['exploring', 'analyzing', 'generating', 'running', 'fixing'].includes(sess.status)) {
        setError(id, msg);
      }
    } finally {
      setFigmaChecking(id, false);
      // Restore idle status only if we set it (i.e. pipeline was not active when we started)
      const sess = getCachedSession(id);
      if (sess && sess.status === ('figma-checking' as string)) {
        setStatus(id, 'idle');
      }
      clearStopping(id);
    }
  })();

  return NextResponse.json({ started: true });
}
