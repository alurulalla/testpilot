import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setError, addLog, updateSession } from '@/lib/session-store';
import { runGenerateSuite, Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import path from 'path';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSessionOrRestore(id, req);
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
        rootDir: getSessionDir(id),
      });
      workspace.init();
      await workspace.installDeps();

      // Forward console.log output from the generator to the session log
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        origLog(...args);
        const raw = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
        // Rewrite raw 401 JSON dumps into a human-readable hint
        const isAuth = raw.includes('401') || raw.includes('authentication_error') || raw.includes('invalid x-api-key');
        const msg = isAuth
          ? '❌ API key rejected (401) — open ⚙ Settings and enter a valid key, then try again.'
          : raw;
        const level = (isAuth || raw.toLowerCase().includes('fail') || raw.toLowerCase().includes('error')) ? 'error' : 'info';
        addLog(id, msg, level);
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
      // Give a targeted hint for authentication failures
      const isAuth = msg.includes('401') || msg.includes('authentication_error') ||
        (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('key'));
      if (isAuth) {
        addLog(id, `❌ API key rejected (401) — open the ⚙ Settings panel and enter a valid key, then try again.`, 'error');
      } else {
        addLog(id, `Generation failed: ${msg}`, 'error');
      }
    }
  })();

  return NextResponse.json({ started: true });
}
