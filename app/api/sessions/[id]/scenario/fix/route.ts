/**
 * POST /api/sessions/[id]/scenario/fix
 *
 * Auto-fixes the failing scenario test, then re-runs it.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { getSession, setScenarioResult, setTestResult, addLog } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { fixTestsPerFile } from '@/lib/fix-tests-per-file';
import type { TestResult } from '@/types/session';
import { getSessionDir } from '@/lib/config';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const scenario = session.scenarioResult;
  if (!scenario?.testFile) {
    return NextResponse.json({ error: 'No scenario test to fix' }, { status: 400 });
  }
  if (scenario.status === 'searching' || scenario.status === 'generating' || scenario.status === 'running') {
    return NextResponse.json({ error: 'Scenario is still running' }, { status: 409 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  setScenarioResult(id, { ...scenario, status: 'generating', error: null });
  addLog(id, `🔧 Auto-fixing scenario test: "${scenario.description}"`, 'info');

  (async () => {
    try {
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const model = withRateLimit(baseModel);

      const fixResult = await fixTestsPerFile(
        workspace,
        model,
        (line) => addLog(id, line, 'info'),
        id,
      );

      if (!fixResult.fixed) {
        addLog(id, 'No fixes could be applied.', 'info');
        setScenarioResult(id, { ...scenario, status: 'done', error: null });
        return;
      }

      addLog(id, `✓ Fixed ${fixResult.filesChanged} file(s). Re-running…`, 'success');

      // Read the updated test content
      const updatedContent = existsSync(scenario.testFile!)
        ? readFileSync(scenario.testFile!, 'utf8')
        : scenario.testContent;

      // Re-run the scenario test
      setScenarioResult(id, {
        ...scenario,
        status: 'running',
        testContent: updatedContent,
        videos: [],
        testResult: null,
        error: null,
      });

      const configPath = workspace.configFile;
      const originalConfig = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;

      try {
        if (originalConfig && !originalConfig.includes('video:')) {
          writeFileSync(
            configPath,
            originalConfig.replace(/(\buse\s*:\s*\{)/, "$1\n    video: 'on',"),
            'utf8',
          );
        }

        const testResult = await runSingleFile(workspace, scenario.testFile!, id);
        const { passed, failed, total } = testResult.stats;
        addLog(
          id,
          `${passed}/${total} passed${failed > 0 ? `, ${failed} still failing` : ' ✅'}`,
          failed === 0 ? 'success' : 'error',
        );

        setScenarioResult(id, {
          ...scenario,
          status: 'done',
          testContent: updatedContent,
          videos: testResult.videos,
          testResult,
          error: null,
        });
        setTestResult(id, testResult);
      } finally {
        if (originalConfig) writeFileSync(configPath, originalConfig, 'utf8');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(id, `Scenario fix failed: ${msg}`, 'error');
      setScenarioResult(id, { ...scenario, status: 'failed', error: msg });
    }
  })();

  return NextResponse.json({ started: true });
}

function runSingleFile(workspace: Workspace, testFile: string, sessionId: string): Promise<TestResult> {
  const relFile = path.relative(workspace.dir, testFile);
  const reportPath = path.join(workspace.dir, 'reports', 'report.json');
  mkdirSync(path.dirname(reportPath), { recursive: true });
  try { require('fs').unlinkSync(reportPath); } catch { /* ok */ }

  const start = Date.now();
  return new Promise<TestResult>((resolve) => {
    const proc = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['playwright', 'test', relFile, '--config', 'playwright.config.ts'],
      { cwd: workspace.dir, stdio: 'pipe', shell: process.platform === 'win32' },
    );

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => {
      const t = d.toString(); output += t;
      t.split('\n').forEach((l: string) => { if (l.trim()) addLog(sessionId, l.trim(), 'info'); });
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const t = d.toString(); output += t;
      t.split('\n').forEach((l: string) => { if (l.trim()) addLog(sessionId, `[stderr] ${l.trim()}`, 'info'); });
    });

    proc.on('close', (code: number | null) => {
      const duration = (Date.now() - start) / 1000;
      let stats = { total: 0, passed: 0, failed: 0, errors: 0 };
      try {
        if (existsSync(reportPath)) {
          const r = JSON.parse(readFileSync(reportPath, 'utf8')) as {
            stats?: { expected?: number; unexpected?: number; skipped?: number };
            errors?: unknown[]; suites?: unknown[];
          };
          if ((r.errors?.length ?? 0) > 0 && (r.suites?.length ?? 0) === 0) {
            stats = { total: 0, passed: 0, failed: 0, errors: r.errors!.length };
          } else {
            const s = r.stats ?? {};
            stats = { total: (s.expected ?? 0) + (s.unexpected ?? 0) + (s.skipped ?? 0), passed: s.expected ?? 0, failed: s.unexpected ?? 0, errors: 0 };
          }
        }
      } catch { stats = { total: 0, passed: 0, failed: 0, errors: 1 }; }

      const videos: string[] = [];
      function scan(dir: string) {
        try {
          readdirSync(dir, { withFileTypes: true }).forEach(e => {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) scan(fp);
            else if (e.name.endsWith('.webm')) videos.push(path.relative(workspace.dir, fp));
          });
        } catch { /* ok */ }
      }
      scan(path.join(workspace.dir, 'test-results'));
      resolve({ code: code ?? 1, duration, stats, output, videos });
    });

    proc.on('error', (err: Error) => resolve({
      code: 1, duration: (Date.now() - start) / 1000,
      stats: { total: 0, passed: 0, failed: 0, errors: 1 }, output: err.message, videos: [],
    }));
  });
}
