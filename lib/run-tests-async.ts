import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import { TestResult, TestStats } from '@/types/session';
import { registerProcess, unregisterProcess } from '@/lib/session-store';
// NOTE: patchPlaywrightConfigForAuth is intentionally NOT called here.
// Generated spec files use manual login (loginAndGoto helpers). Adding a global
// storageState: './auth.json' would pre-authenticate the browser context so that
// navigating to '/' redirects to /inventory.html before the login form appears,
// breaking every test that tries to fill the login form. auth.json is used only
// during exploration (authenticated-site-explorer), not for test execution.

function parseStats(reportPath: string): TestStats {
  if (!existsSync(reportPath)) {
    return { total: 0, passed: 0, failed: 0, errors: 1 };
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      suites?: unknown[];
      errors?: { message: string }[];
      stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
    };
    if ((report.errors?.length ?? 0) > 0 && (report.suites?.length ?? 0) === 0) {
      return { total: 0, passed: 0, failed: 0, errors: report.errors!.length };
    }
    const s = report.stats ?? {};
    const passed = s.expected ?? 0;
    const failed = s.unexpected ?? 0;
    const skipped = s.skipped ?? 0;
    return { total: passed + failed + skipped, passed, failed, errors: 0 };
  } catch {
    return { total: 0, passed: 0, failed: 0, errors: 1 };
  }
}

/**
 * Patch playwright.config.ts in the workspace to enable video recording.
 * Safe to call multiple times — skips if video is already configured.
 */
function patchPlaywrightConfigForVideo(workspaceDir: string): void {
  const configPath = path.join(workspaceDir, 'playwright.config.ts');
  if (!existsSync(configPath)) return;
  try {
    let content = readFileSync(configPath, 'utf8');
    if (content.includes('video:')) return; // already configured
    content = content.replace(/(\buse\s*:\s*\{)/, "$1\n    video: 'on',");
    writeFileSync(configPath, content, 'utf8');
  } catch {
    // Non-fatal — tests will still run without video
  }
}

/** Recursively find all .webm video files and return paths relative to workspaceDir */
function collectVideos(workspaceDir: string): string[] {
  const testResultsDir = path.join(workspaceDir, 'test-results');
  const videos: string[] = [];
  if (!existsSync(testResultsDir)) return videos;

  function scan(dir: string) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile() && entry.name.endsWith('.webm')) {
        videos.push(path.relative(workspaceDir, full));
      }
    }
  }

  scan(testResultsDir);
  return videos;
}

// Non-blocking test runner — uses spawn() so the Node.js event loop stays free for SSE.
// Pass sessionId to register the child process for killable stop support.
export async function runTestsAsync(
  workspace: Workspace,
  onProgress?: (line: string) => void,
  sessionId?: string,
  headed = false,
): Promise<TestResult> {
  const reportsDir = path.join(workspace.dir, 'reports');
  const testResultsDir = path.join(workspace.dir, 'test-results');
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(testResultsDir, { recursive: true });

  const reportPath = path.join(reportsDir, 'report.json');
  try { unlinkSync(reportPath); } catch { /* no prior report */ }

  // Enable video recording — ffmpeg is installed in the Docker image
  patchPlaywrightConfigForVideo(workspace.dir);

  const start = Date.now();

  return new Promise((resolve) => {
    // Resolve the Playwright CLI entry point directly from node_modules so
    // we never rely on `npx` finding the `playwright` binary.
    const playwrightCliCandidates = [
      path.join(workspace.dir, 'node_modules', 'playwright', 'cli.js'),
      path.join(process.cwd(), 'node_modules', 'playwright', 'cli.js'),
    ];
    const playwrightCli = playwrightCliCandidates.find(existsSync)
      ?? playwrightCliCandidates[0];

    const nodeArgs = [playwrightCli, 'test', '--config', 'playwright.config.ts'];
    if (headed) nodeArgs.push('--headed');

    const proc = spawn(
      process.execPath,
      nodeArgs,
      {
        cwd: workspace.dir,
        stdio: 'pipe',
        env: { ...process.env },
      },
    );

    if (sessionId) registerProcess(sessionId, proc);

    let output = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      for (const l of text.split('\n')) {
        if (l.trim()) onProgress?.(l.trim());
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      for (const l of text.split('\n')) {
        if (l.trim()) onProgress?.(`[stderr] ${l.trim()}`);
      }
    });

    proc.on('close', (code) => {
      if (sessionId) unregisterProcess(sessionId);
      const duration = (Date.now() - start) / 1000;
      const stats = parseStats(reportPath);
      const videos = collectVideos(workspace.dir);
      resolve({ code: code ?? 1, duration, stats, output, videos });
    });

    proc.on('error', (err) => {
      if (sessionId) unregisterProcess(sessionId);
      const duration = (Date.now() - start) / 1000;
      resolve({
        code: 1,
        duration,
        stats: { total: 0, passed: 0, failed: 0, errors: 1 },
        output: err.message,
        videos: [],
      });
    });
  });
}
