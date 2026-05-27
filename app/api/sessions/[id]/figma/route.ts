import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setFigmaResult, setError, addLog, clearStopping } from '@/lib/session-store';
import { runFigmaComparison, isFigmaConfigured } from '@/lib/figma-client';
import { getFigmaToken } from '@/lib/config';
import { Workspace } from '@/lib/pilot';
import path from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  addLog(id, 'Running Figma visual comparison…', 'info');

  (async () => {
    clearStopping(id);
    try {
      const workspace = new Workspace({
        url: session.url,
        rootDir: path.join(process.cwd(), '.testpilot', id),
      });

      // Pass known site URLs from the site map so frames can be matched to real pages
      const knownUrls = session.siteMap?.pages.map(p => p.url) ?? [];

      const result = await runFigmaComparison(
        token!,
        session.figmaFileUrl!,
        session.url,
        workspace.dir,
        knownUrls,
        (line) => addLog(id, line, 'info'),
      );

      setFigmaResult(id, result);
      addLog(
        id,
        `Figma comparison complete: ${result.comparisons.length} frame(s) compared, test file generated.`,
        'success',
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
