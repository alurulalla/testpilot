/**
 * POST /api/sessions/[id]/run-file
 *
 * Body: { testFile: string }   ← absolute path to a single spec file
 *
 * Runs just that one file with Playwright, registers the spawned process
 * so the existing /stop route can kill it. Updates session.testResult when done.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import {
  getSession,
  setStatus,
  setTestResult,
  addLog,
  registerProcess,
  unregisterProcess,
} from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import type { TestResult } from '@/types/session';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  if (['exploring', 'generating', 'running', 'fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { testFile?: string };
  const testFile = body.testFile;
  if (!testFile) {
    return NextResponse.json({ error: 'testFile is required' }, { status: 400 });
  }
  if (!existsSync(testFile)) {
    return NextResponse.json({ error: 'Test file not found on disk' }, { status: 404 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: path.join(process.cwd(), '.testpilot', id),
  });

  setStatus(id, 'running');
  const fileName = path.basename(testFile);
  addLog(id, `▶ Running ${fileName}…`, 'info');

  (async () => {
    const relFile = path.relative(workspace.dir, testFile);
    const reportPath = path.join(workspace.dir, 'reports', 'report.json');
    mkdirSync(path.dirname(reportPath), { recursive: true });
    try { require('fs').unlinkSync(reportPath); } catch { /* ok */ }

    const start = Date.now();

    const result = await new Promise<TestResult>((resolve) => {
      const proc = spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['playwright', 'test', relFile, '--config', 'playwright.config.ts'],
        { cwd: workspace.dir, stdio: 'pipe', shell: process.platform === 'win32' },
      );

      registerProcess(id, proc);

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => {
        const t = d.toString(); output += t;
        t.split('\n').forEach((l: string) => { if (l.trim()) addLog(id, l.trim(), 'info'); });
      });
      proc.stderr?.on('data', (d: Buffer) => {
        const t = d.toString(); output += t;
        t.split('\n').forEach((l: string) => {
          if (l.trim()) addLog(id, `[stderr] ${l.trim()}`, 'info');
        });
      });

      proc.on('close', (code: number | null) => {
        unregisterProcess(id);
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
              stats = {
                total: (s.expected ?? 0) + (s.unexpected ?? 0) + (s.skipped ?? 0),
                passed: s.expected ?? 0,
                failed: s.unexpected ?? 0,
                errors: 0,
              };
            }
          }
        } catch { stats = { total: 0, passed: 0, failed: 0, errors: 1 }; }

        // Collect .webm recordings
        const videos: string[] = [];
        const scan = (dir: string) => {
          try {
            readdirSync(dir, { withFileTypes: true }).forEach(e => {
              const fp = path.join(dir, e.name);
              if (e.isDirectory()) scan(fp);
              else if (e.name.endsWith('.webm')) videos.push(path.relative(workspace.dir, fp));
            });
          } catch { /* ok */ }
        };
        scan(path.join(workspace.dir, 'test-results'));

        resolve({ code: code ?? 1, duration, stats, output, videos });
      });

      proc.on('error', (err: Error) => {
        unregisterProcess(id);
        resolve({
          code: 1,
          duration: (Date.now() - start) / 1000,
          stats: { total: 0, passed: 0, failed: 0, errors: 1 },
          output: err.message,
          videos: [],
        });
      });
    });

    const { passed, failed, total } = result.stats;
    addLog(
      id,
      `${fileName}: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ' ✅'}`,
      failed === 0 ? 'success' : 'error',
    );
    setTestResult(id, result);
    setStatus(id, 'idle');
  })();

  return NextResponse.json({ started: true });
}
