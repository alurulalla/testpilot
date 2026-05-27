import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setError, addLog, updateSession } from '@/lib/session-store';
import { runGenerateSuite, Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import path from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.siteMap) return NextResponse.json({ error: 'Run explore first' }, { status: 400 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'generating');
  addLog(id, 'Generating test suite…', 'info');

  (async () => {
    try {
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);
      const workspace = new Workspace({
        url: session.url,
        rootDir: path.join(process.cwd(), '.testpilot', id),
      });
      workspace.init();
      await workspace.installDeps();

      // Forward console.log output from the generator to the session log
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
          maxPages: 10,
          model: llmConfig.model,
          chatModel,
          workspace,
        });
      } finally {
        console.log = origLog;
      }

      const testFiles = workspace.testFiles();
      updateSession(id, { testFiles, status: 'idle' });
      addLog(id, `Generated ${testFiles.length} test file(s).`, testFiles.length > 0 ? 'success' : 'error');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Generation failed: ${msg}`, 'error');
    }
  })();

  return NextResponse.json({ started: true });
}
