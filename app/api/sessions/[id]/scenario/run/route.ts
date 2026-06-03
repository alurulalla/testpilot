/**
 * POST /api/sessions/[id]/scenario/run
 *
 * Runs the test that was found (or already generated) and saved in
 * session.scenarioResult. Used when the user hits "Run" on a found test.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { spawn } from 'child_process';
import { getSession, setScenarioResult, setTestResult, addLog } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import type { TestResult } from '@/types/session';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSessionOrRestore(id, req);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const scenario = session.scenarioResult;
  if (!scenario) {
    return NextResponse.json({ error: 'No scenario test to run' }, { status: 400 });
  }

  // Optional override: run a specific file from the available-tests list
  const body = await req.json().catch(() => ({})) as { testFile?: string };
  const testFileToRun = body.testFile ?? scenario.testFile;
  if (!testFileToRun) {
    return NextResponse.json({ error: 'No test file specified' }, { status: 400 });
  }

  // If the user picked a different file from the list, update testFile so
  // subsequent Re-run / Auto-fix operate on the correct file.
  const activeScenario = testFileToRun !== scenario.testFile
    ? { ...scenario, testFile: testFileToRun }
    : scenario;

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  setScenarioResult(id, { ...activeScenario, status: 'running', videos: [], testResult: null });
  addLog(id, `▶ Running scenario test: "${scenario.description}"`, 'info');

  (async () => {
    const configPath = workspace.configFile;
    const originalConfig = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;

    try {
      // Patch config: ensure video: 'on'
      if (originalConfig && !originalConfig.includes('video:')) {
        writeFileSync(
          configPath,
          originalConfig.replace(/(\buse\s*:\s*\{)/, "$1\n    video: 'on',"),
          'utf8',
        );
      }

      const testResult = await runSingleFile(workspace, testFileToRun, id);
      const { passed, failed, total } = testResult.stats;
      addLog(id, `${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ' ✅'}`, failed === 0 ? 'success' : 'error');
      setScenarioResult(id, { ...activeScenario, status: 'done', videos: testResult.videos, testResult, error: null });
      setTestResult(id, testResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(id, `Scenario run failed: ${msg}`, 'error');
      setScenarioResult(id, { ...activeScenario, status: 'failed', error: msg });
    } finally {
      if (originalConfig) writeFileSync(configPath, originalConfig, 'utf8');
    }
  })();

  return NextResponse.json({ started: true });
}

function runSingleFile(workspace: Workspace, testFile: string, sessionId: string): Promise<TestResult> {
  const relFile  = path.relative(workspace.dir, testFile);
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
          const r = JSON.parse(readFileSync(reportPath, 'utf8')) as { stats?: { expected?: number; unexpected?: number; skipped?: number }; errors?: unknown[]; suites?: unknown[] };
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
        try { readdirSync(dir, { withFileTypes: true }).forEach(e => { const fp = path.join(dir, e.name); if (e.isDirectory()) scan(fp); else if (e.name.endsWith('.webm')) videos.push(path.relative(workspace.dir, fp)); }); } catch { /* ok */ }
      }
      scan(path.join(workspace.dir, 'test-results'));
      resolve({ code: code ?? 1, duration, stats, output, videos });
    });

    proc.on('error', (err: Error) => resolve({ code: 1, duration: (Date.now() - start) / 1000, stats: { total: 0, passed: 0, failed: 0, errors: 1 }, output: err.message, videos: [] }));
  });
}
