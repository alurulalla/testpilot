import { NextRequest, NextResponse } from 'next/server';
import {
  getSession, setStatus, setFixResult, setTestResult, setTriageResult,
  setError, addLog, clearStopping,
} from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { fixTestsPerFile } from '@/lib/fix-tests-per-file';
import { triageFailures } from '@/lib/triage-failures';
import { runTestsAsync } from '@/lib/run-tests-async';
import path from 'path';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSessionOrRestore(id, req);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.testResult) return NextResponse.json({ error: 'Run tests first' }, { status: 400 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  setStatus(id, 'fixing');
  addLog(id, 'Running self-healing…', 'info');

  (async () => {
    clearStopping(id);
    try {
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);
      const workspace = new Workspace({
        url: session.url,
        rootDir: getSessionDir(id),
      });

      // Run triage if not already done for this test result
      let triage = session.triageResult;
      if (!triage && (session.testResult?.stats.failed ?? 0) > 0) {
        addLog(id, 'Analysing failures before healing…', 'info');
        triage = await triageFailures(
          workspace,
          session.contextDoc,
          session.url,
          chatModel,
          (line) => addLog(id, line, 'info'),
        ).catch(() => null);
        if (triage) setTriageResult(id, triage);
      }

      // Summarise what we're going to do (and what we're skipping)
      if (triage) {
        if (triage.appBugCount > 0) {
          const appBugNames = triage.analyses
            .filter(a => a.verdict === 'app_bug')
            .map(a => `  • ${a.testName}: ${a.reasoning}`)
            .join('\n');
          addLog(
            id,
            `⚠ Skipping ${triage.appBugCount} app bug(s) — these are real application gaps:\n${appBugNames}`,
            'error',
          );
        }
        if (!triage.selfHealRecommended) {
          addLog(id, 'All failures are application bugs. Nothing to auto-heal.', 'info');
          setFixResult(id, { fixed: false, filesChanged: 0 });
          setStatus(id, 'idle');
          return;
        }
      }

      const result = await fixTestsPerFile(
        workspace,
        chatModel,
        (line) => addLog(id, line, 'info'),
        id,
        triage?.analyses,
      );

      setFixResult(id, { fixed: result.fixed, filesChanged: result.filesChanged });
      addLog(
        id,
        result.fixed ? `Fixed ${result.filesChanged} file(s).` : 'No fixes applied.',
        result.fixed ? 'success' : 'info',
      );

      // Re-run to verify fixes
      setStatus(id, 'running');
      setTriageResult(id, null);
      addLog(id, 'Re-running tests to verify fixes…', 'info');
      const testResult = await runTestsAsync(
        workspace,
        (line) => addLog(id, line, 'info'),
        id,
        getSession(id)?.headedMode ?? false,
      );
      setTestResult(id, testResult);

      const { passed, failed, total, errors } = testResult.stats;
      if (errors > 0 && total === 0) {
        addLog(id, 'Verification run failed — test files may have syntax errors.', 'error');
      } else {
        addLog(
          id,
          `Verification: ${passed}/${total} passed${failed > 0 ? `, ${failed} still failing` : ' — all green! ✅'}.`,
          failed === 0 ? 'success' : 'error',
        );
      }

      // Re-triage remaining failures after the fix run
      if (failed > 0) {
        const reTriage = await triageFailures(
          workspace,
          getSession(id)?.contextDoc ?? null,
          getSession(id)?.url ?? session.url,
          chatModel,
          (line) => addLog(id, line, 'info'),
        ).catch(() => null);
        if (reTriage) setTriageResult(id, reTriage);
      }

      setStatus(id, 'idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      const isAuth = msg.includes('401') || msg.includes('authentication_error') ||
        (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('key'));
      addLog(
        id,
        isAuth
          ? '❌ API key rejected (401) — open ⚙ Settings and enter a valid key, then try again.'
          : `Autofix failed: ${msg}`,
        'error',
      );
    } finally {
      clearStopping(id);
    }
  })();

  return NextResponse.json({ started: true });
}
