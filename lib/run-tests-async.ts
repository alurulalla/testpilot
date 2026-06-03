import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import { TestResult, TestStats } from '@/types/session';
import { registerProcess, unregisterProcess } from '@/lib/session-store';
import { patchPlaywrightConfigForAuth } from '@/lib/pre-login';

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
    // Insert video: 'on' at the start of the use: { … } block
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
// Uses spawn() so the Node.js event loop stays free for SSE and other requests.
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

  // Ensure playwright.config.ts records video so we can replay in the UI
  patchPlaywrightConfigForVideo(workspace.dir);
  // Inject auth.json storageState if pre-login was performed for this session
  patchPlaywrightConfigForAuth(workspace.dir);

  const start = Date.now();

  // On Vercel, Playwright's bundled Chromium is not available. Use the
  // @sparticuz/chromium binary (which self-extracts to /tmp on first call)
  // and tell Playwright where to find it via the env var.
  let chromiumEnv: Record<string, string> = {};
  if (process.env.VERCEL === '1') {
    try {
      const { default: Chromium } = await import('@sparticuz/chromium') as { default: { executablePath: () => Promise<string>; args: string[] } };
      const executablePath = await Chromium.executablePath();
      chromiumEnv = { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executablePath };
    } catch {
      // Non-fatal — Playwright will try its default browser lookup
    }
  }

  return new Promise((resolve) => {
    // Resolve the Playwright CLI entry point directly from node_modules so
    // we never rely on `npx` finding the `playwright` binary.  On Vercel the
    // workspace's node_modules is a symlink to /var/task/node_modules, so
    // the CLI file exists at a known absolute path.  We run it with the
    // current Node.js executable (process.execPath) rather than via a shell.
    const playwrightCliCandidates = [
      // 1. Through the workspace's node_modules symlink (Vercel / local both)
      path.join(workspace.dir, 'node_modules', '@playwright', 'test', 'cli.js'),
      // 2. App-level node_modules fallback
      path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js'),
    ];
    const playwrightCli = playwrightCliCandidates.find(existsSync)
      ?? playwrightCliCandidates[0]; // use first and let it fail with a clear error

    const nodeArgs = [playwrightCli, 'test', '--config', 'playwright.config.ts'];
    if (headed) nodeArgs.push('--headed');

    const proc = spawn(
      process.execPath, // current node binary — always available
      nodeArgs,
      {
        cwd: workspace.dir,
        stdio: 'pipe',
        env: { ...process.env, ...chromiumEnv },
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
      // Surface stderr as errors so SyntaxError / compilation failures are visible
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
