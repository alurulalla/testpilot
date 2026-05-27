import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setSiteMap, setError, addLog } from '@/lib/session-store';
import { runSiteExplorer, Workspace } from '@/lib/pilot';
import { SiteMap } from '@/types/session';
import path from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'exploring');
  addLog(id, `Starting exploration of ${session.url}`, 'info');

  (async () => {
    try {
      const workspace = new Workspace({ url: session.url, rootDir: path.join(process.cwd(), '.testpilot', id) });
      workspace.init();
      const siteMap = await runSiteExplorer({
        url: session.url,
        depth: 2,
        maxPages: 10,
        writeSiteMap: true,
        outputDir: workspace.dir,
        onProgress: (line: string) => addLog(id, line, 'info'),
      });
      setSiteMap(id, siteMap as unknown as SiteMap);
      setStatus(id, 'idle');
      addLog(id, `Exploration complete. Found ${siteMap.total_pages} pages.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Exploration failed: ${msg}`, 'error');
    }
  })();

  return NextResponse.json({ started: true });
}
