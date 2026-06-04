import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setFigmaResult, setError, addLog, clearStopping } from '@/lib/session-store';
import { runFigmaComparison, isFigmaConfigured } from '@/lib/figma-client';
import { getFigmaToken, getSessionDir } from '@/lib/config';
import { Workspace, createModelFromConfig } from '@/lib/pilot';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import path from 'path';


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (['exploring', 'generating', 'running', 'fixing', 'figma-checking'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  const token = getFigmaToken();
  if (!isFigmaConfigured(token, session.figmaFileUrl)) {
    return NextResponse.json(
      { error: 'Figma not configured — add FIGMA_TOKEN to .env.local and a Figma URL to this session' },
      { status: 400 },
    );
  }

  // Cast status — we use a custom status string here (not in the union type) to keep things simple;
  // the session page treats any unknown status as 'running' for the badge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setStatus(id, 'figma-checking' as any);
  addLog(id, 'Running Figma DOM verification…', 'info');

  (async () => {
    clearStopping(id);
    try {
      const workspace = new Workspace({
        url: session.url,
        rootDir: getSessionDir(id),
      });

      // Build LLM model for DOM comparison
      const llmConfig = getLlmConfig();
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
      );

      setFigmaResult(id, result);
      const totalIssues = result.comparisons.reduce(
        (n, c) => n + (c.discrepancies?.length ?? 0), 0,
      );
      const avgScore = result.comparisons.length > 0
        ? Math.round(
            result.comparisons.reduce((n, c) => n + (c.matchScore ?? 100), 0) /
            result.comparisons.length,
          )
        : 100;
      addLog(
        id,
        `Figma verification complete: ${result.comparisons.length} frame(s) analysed, ` +
        `${totalIssues} discrepancy(ies) found, avg match score ${avgScore}/100.`,
        totalIssues === 0 ? 'success' : 'info',
      );
      setStatus(id, 'idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Figma comparison failed: ${msg}`, 'error');
    } finally {
      clearStopping(id);
    }
  })();

  return NextResponse.json({ started: true });
}
