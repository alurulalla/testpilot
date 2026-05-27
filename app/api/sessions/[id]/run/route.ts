import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setTestResult, setError, addLog } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { runTestsAsync } from '@/lib/run-tests-async';
import path from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.testFiles.length === 0) return NextResponse.json({ error: 'No tests to run' }, { status: 400 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'running');
  addLog(id, 'Running test suite…', 'info');

  (async () => {
    try {
      const workspace = new Workspace({
        url: session.url,
        rootDir: path.join(process.cwd(), '.testpilot', id),
      });

      const result = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, session.headedMode ?? false);
      setTestResult(id, result);
      setStatus(id, 'idle');

      const { passed, failed, total, errors } = result.stats;
      if (errors > 0 && total === 0) {
        addLog(id, `Test run failed — check log above for errors (syntax error or no tests found).`, 'error');
      } else {
        addLog(id, `Tests complete: ${passed}/${total} passed.`, failed === 0 ? 'success' : 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Test run failed: ${msg}`, 'error');
    }
  })();

  return NextResponse.json({ started: true });
}
