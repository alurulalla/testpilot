/**
 * POST /api/sessions/[id]/scenario
 *
 * Body: { description: string }
 *
 * Flow:
 *  1. Create LLM model.
 *  2. Ask the LLM whether any existing spec file covers the scenario (intent match).
 *  2a. If found  → set status:'found', stop.
 *  2b. If not found → generate a new focused test, run it with video recording.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getSession, setScenarioResult, setTestResult, addLog } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { findExistingTest, generateScenarioTest } from '@/lib/pilot/generate-scenario';
import type { ScenarioResult } from '@/types/session';
import { getSessionDir } from '@/lib/config';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { description?: string };
  const description = (body.description ?? '').trim();
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  // ── Step 1: check existing tests ─────────────────────────────────────────

  const initial: ScenarioResult = {
    description,
    status: 'searching',
    wasFound: false,
    testFile: null,
    testContent: null,
    matchedTests: [],
    availableTests: [],
    videos: [],
    testResult: null,
    error: null,
  };
  setScenarioResult(id, initial);
  addLog(id, `🔍 Searching for existing test: "${description}"`, 'info');

  // Everything (find + optional generate) runs in the background so the
  // HTTP response is immediate. The model is created once and reused for both.
  (async () => {
    try {
      // Create model first — needed for the LLM-based intent matcher
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const model = withRateLimit(baseModel);

      // ── LLM-based search: does any existing test cover this scenario? ──────
      const findResult = await findExistingTest(description, workspace, model);

      if (findResult.found) {
        addLog(id, `✅ Found existing test: ${findResult.matchedTests.slice(0, 2).join(', ')}`, 'success');
        setScenarioResult(id, {
          ...initial,
          status: 'found',
          wasFound: true,
          testFile: findResult.testFile,
          testContent: findResult.testContent,
          matchedTests: findResult.matchedTests,
          availableTests: findResult.allTests,
        });
        return;
      }

      // ── Not found — generate + auto-run ────────────────────────────────────
      addLog(id, `✨ No existing test found — generating a new one…`, 'info');
      setScenarioResult(id, { ...initial, status: 'generating', availableTests: findResult.allTests });

      // Ensure workspace is ready
      workspace.init();
      if (!require('fs').existsSync(path.join(workspace.dir, 'node_modules'))) {
        addLog(id, 'Installing workspace dependencies…', 'info');
        await workspace.installDeps();
      }

      const siteMapPages = session.siteMap?.pages.map(p => ({
        url: p.url,
        title: p.title,
        elements: p.elements,
      })) ?? [];

      // Log which pages were matched before generation
      if (siteMapPages.length > 0) {
        const { findRelevantPages } = await import('@/lib/pilot/generate-scenario');
        const top = findRelevantPages(description, siteMapPages, 1);
        if (top.length > 0) {
          addLog(id, `🎯 Most relevant page: ${top[0].url} — "${top[0].title}"`, 'info');
        }
      }

      const genResult = await generateScenarioTest({
        description,
        workspace,
        model,
        siteMapPages,
      });

      // The generated file is now part of the available list too
      const generatedEntry = {
        testFile: genResult.testFile,
        fileName: genResult.testFile.split('/').pop() ?? genResult.testFile,
        testNames: genResult.matchedTests,
      };
      const updatedAvailable = [
        ...findResult.allTests.filter(t => t.testFile !== genResult.testFile),
        generatedEntry,
      ];

      addLog(id, `📝 Generated test: ${generatedEntry.fileName}`, 'success');
      setScenarioResult(id, {
        ...initial,
        status: 'running',
        wasFound: false,
        testFile: genResult.testFile,
        testContent: genResult.testContent,
        matchedTests: genResult.matchedTests,
        availableTests: updatedAvailable,
      });

      // Run ONLY the generated scenario file
      addLog(id, `▶ Running scenario test…`, 'info');
      const testResult = await runScenarioFile(workspace, genResult.testFile, id);

      const { passed, failed, total } = testResult.stats;
      addLog(
        id,
        `${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ' ✅'}`,
        failed === 0 ? 'success' : 'error',
      );

      setScenarioResult(id, {
        description,
        status: 'done',
        wasFound: false,
        testFile: genResult.testFile,
        testContent: genResult.testContent,
        matchedTests: genResult.matchedTests,
        availableTests: updatedAvailable,
        videos: testResult.videos,
        testResult,
        error: null,
      });
      setTestResult(id, testResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes('401') || msg.includes('authentication_error') ||
        (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('key'));
      addLog(id, isAuth
        ? '❌ API key rejected (401) — open ⚙ Settings and enter a valid key, then try again.'
        : `Scenario failed: ${msg}`, 'error');
      setScenarioResult(id, { ...initial, status: 'failed', error: msg });
    }
  })();

  return NextResponse.json({ status: 'searching' });
}

/** Run a SINGLE specific spec file inside the workspace with video always on. */
async function runScenarioFile(
  workspace: Workspace,
  testFile: string,
  sessionId: string,
) {
  const { existsSync: fse, readFileSync: rf, writeFileSync: wf } = require('fs') as typeof import('fs');
  const { spawn } = require('child_process') as typeof import('child_process');
  const { mkdirSync } = require('fs') as typeof import('fs');
  const pathMod = require('path') as typeof import('path');

  const configPath = workspace.configFile;
  const originalConfig = fse(configPath) ? rf(configPath, 'utf8') : null;

  // Patch config: add video: 'on' so the recording is always captured
  if (originalConfig) {
    let patched = originalConfig;
    if (!patched.includes("video:")) {
      patched = patched.replace(/(\buse\s*:\s*\{)/, "$1\n    video: 'on',");
      wf(configPath, patched, 'utf8');
    }
  }

  // Resolve the file path relative to workspace dir (Playwright CLI arg)
  const relFile = pathMod.relative(workspace.dir, testFile);

  const reportsDir = pathMod.join(workspace.dir, 'reports');
  const reportPath = pathMod.join(reportsDir, 'report.json');
  mkdirSync(reportsDir, { recursive: true });
  try { require('fs').unlinkSync(reportPath); } catch { /* no prior report */ }

  const start = Date.now();

  return new Promise<import('@/types/session').TestResult>((resolve) => {
    // Pass the specific file as a positional argument so only it runs
    const args = [
      'playwright', 'test',
      relFile,                    // ← run ONLY this file
      '--config', 'playwright.config.ts',
    ];

    const proc = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args,
      { cwd: workspace.dir, stdio: 'pipe', shell: process.platform === 'win32' },
    );

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      output += text;
      text.split('\n').forEach((l: string) => { if (l.trim()) addLog(sessionId, l.trim(), 'info'); });
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      output += text;
      text.split('\n').forEach((l: string) => { if (l.trim()) addLog(sessionId, `[stderr] ${l.trim()}`, 'info'); });
    });

    proc.on('close', (code: number | null) => {
      const duration = (Date.now() - start) / 1000;

      // Parse stats from JSON report
      let stats = { total: 0, passed: 0, failed: 0, errors: 0 };
      try {
        if (fse(reportPath)) {
          const report = JSON.parse(rf(reportPath, 'utf8')) as {
            stats?: { expected?: number; unexpected?: number; skipped?: number };
            errors?: unknown[];
            suites?: unknown[];
          };
          if ((report.errors?.length ?? 0) > 0 && (report.suites?.length ?? 0) === 0) {
            stats = { total: 0, passed: 0, failed: 0, errors: report.errors!.length };
          } else {
            const s = report.stats ?? {};
            const passed = s.expected ?? 0;
            const failed = s.unexpected ?? 0;
            const skipped = s.skipped ?? 0;
            stats = { total: passed + failed + skipped, passed, failed, errors: 0 };
          }
        }
      } catch { stats = { total: 0, passed: 0, failed: 0, errors: 1 }; }

      // Collect videos
      const videos: string[] = [];
      const testResultsDir = pathMod.join(workspace.dir, 'test-results');
      function scanVideos(dir: string) {
        try {
          require('fs').readdirSync(dir, { withFileTypes: true }).forEach((e: import('fs').Dirent) => {
            const full = pathMod.join(dir, e.name);
            if (e.isDirectory()) scanVideos(full);
            else if (e.isFile() && e.name.endsWith('.webm')) videos.push(pathMod.relative(workspace.dir, full));
          });
        } catch { /* ignore */ }
      }
      if (fse(testResultsDir)) scanVideos(testResultsDir);

      resolve({ code: code ?? 1, duration, stats, output, videos });
    });

    proc.on('error', (err: Error) => {
      resolve({ code: 1, duration: (Date.now() - start) / 1000,
        stats: { total: 0, passed: 0, failed: 0, errors: 1 }, output: err.message, videos: [] });
    });
  }).finally(() => {
    // Restore original config so the full test suite isn't affected
    if (originalConfig) wf(configPath, originalConfig, 'utf8');
  });
}

/** GET /api/sessions/[id]/scenario — return current scenario state. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  return NextResponse.json(session.scenarioResult ?? null);
}
