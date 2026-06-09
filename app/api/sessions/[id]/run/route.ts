import { NextRequest, NextResponse } from 'next/server';
import { getSession, getCachedSession, setStatus, setTestResult, setTriageResult, setError, clearError, addLog } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { runTestsAsync } from '@/lib/run-tests-async';
import { ensureWorkspaceReady } from '@/lib/session-files';
import { triageFailures } from '@/lib/triage-failures';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import path from 'path';
import { getSessionDir, getAutoSelfHeal } from '@/lib/config';


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.testFiles.length === 0) return NextResponse.json({ error: 'No tests to run' }, { status: 400 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'running');
  setTriageResult(id, null); // clear previous triage on each new run
  clearError(id);            // drop any error from a previous run
  addLog(id, 'Running test suite…', 'info');

  (async () => {
    try {
      const workspace = new Workspace({
        url: session.url,
        rootDir: getSessionDir(id, session.orgId),
      });

      // Rebuild the workspace from the DB if the disk was wiped (e.g. redeploy),
      // so "execute tests" works even on a fresh container.
      const restored = await ensureWorkspaceReady(id, workspace);
      if (restored > 0) addLog(id, `Restored ${restored} test file(s) from saved suite.`, 'info');

      const result = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, session.headedMode ?? false);
      setTestResult(id, result);
      setStatus(id, 'idle');

      const { passed, failed, total, errors } = result.stats;
      if (errors > 0 && total === 0) {
        addLog(id, 'Test run failed — check log above for errors (syntax error or no tests found).', 'error');
        return;
      }

      addLog(id, `Tests complete: ${passed}/${total} passed.`, failed === 0 ? 'success' : 'error');

      // Triage failures so the UI can show app-bug vs test-bug badges
      if (failed > 0) {
        try {
          addLog(id, 'Analysing failures…', 'info');
          const llmConfig = await getOrgLlmConfig(session.orgId);
          const baseModel = await createModelFromConfig(llmConfig);
          const chatModel = withRateLimit(baseModel);
          const fresh = getCachedSession(id);
          const triage = await triageFailures(
            workspace,
            fresh?.contextDoc ?? null,
            fresh?.url ?? session.url,
            chatModel,
            (line) => addLog(id, line, 'info'),
          );
          setTriageResult(id, triage);

          if (triage.appBugCount > 0) {
            addLog(
              id,
              `⚠ ${triage.appBugCount} failure(s) look like application gaps — the app may not match its documentation.`,
              'error',
            );
          }
          if (triage.testBugCount + triage.ambiguousCount > 0) {
            const autoHeal = getAutoSelfHeal();
            addLog(
              id,
              `🔧 ${triage.testBugCount + triage.ambiguousCount} failure(s) are test-code issues.` +
              (autoHeal ? ' Auto-healing is ON — use the loop to fix automatically.' : ' Click Self-Heal to fix.'),
              'info',
            );
          }
        } catch {
          addLog(id, 'Failure analysis skipped (LLM unavailable).', 'info');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Test run failed: ${msg}`, 'error');
    }
  })();

  return NextResponse.json({ started: true });
}
