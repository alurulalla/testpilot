import { NextRequest, NextResponse } from 'next/server';
import { getSession, setStatus, setFixResult, setTestResult, setError, addLog, clearStopping } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { fixTestsPerFile } from '@/lib/fix-tests-per-file';
import { runTestsAsync } from '@/lib/run-tests-async';
import path from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.testResult) return NextResponse.json({ error: 'Run tests first' }, { status: 400 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'fixing');
  addLog(id, 'Running self-healing autofix…', 'info');

  (async () => {
    clearStopping(id);
    try {
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);
      const workspace = new Workspace({
        url: session.url,
        rootDir: path.join(process.cwd(), '.testpilot', id),
      });

      const result = await fixTestsPerFile(workspace, chatModel, (line) => addLog(id, line, 'info'), id);
      setFixResult(id, result);
      addLog(
        id,
        `Autofix complete: ${result.fixed ? `${result.filesChanged} file(s) fixed` : 'no fixes applied'}.`,
        result.fixed ? 'success' : 'info',
      );

      // Always re-run tests after fix so the results reflect the current state
      setStatus(id, 'running');
      addLog(id, 'Re-running tests to verify fixes…', 'info');
      const testResult = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, getSession(id)?.headedMode ?? false);
      setTestResult(id, testResult);
      const { passed, failed, total, errors } = testResult.stats;
      if (errors > 0 && total === 0) {
        addLog(id, `Verification run failed — test files may have syntax errors.`, 'error');
      } else {
        addLog(
          id,
          `Verification: ${passed}/${total} passed${failed > 0 ? `, ${failed} still failing` : ' — all green! ✅'}.`,
          failed === 0 ? 'success' : 'error',
        );
      }
      setStatus(id, 'idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Autofix failed: ${msg}`, 'error');
    } finally {
      clearStopping(id);
    }
  })();

  return NextResponse.json({ started: true });
}
