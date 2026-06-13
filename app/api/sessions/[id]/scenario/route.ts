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
import { requireSessionAccess } from '@/lib/session-access';
import path from 'path';
import { getSession, getCachedSession, setScenarioResult, setTestResult, addLog, updateSession } from '@/lib/session-store';
import { snapshotTestFiles, ensureWorkspaceReady } from '@/lib/session-files';
import { recordTestRun, mergeTestResult } from '@/lib/test-runs';
import { recordScenario } from '@/lib/scenarios';
import { parsePlaywrightReport } from '@/lib/playwright-report';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { findExistingTest, generateScenarioTest, findRelevantPages } from '@/lib/pilot/generate-scenario';
import {
  detectMultiStep, extractIntent, generateFlowTest,
  refineScenarioTest, refinementKeepsAssertions,
} from '@/lib/pilot/scenario-flow';
import type { ScenarioResult } from '@/types/session';
import { getSessionDir } from '@/lib/config';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { description?: string };
  const description = (body.description ?? '').trim();
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id, session.orgId),
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
      const llmConfig = await getOrgLlmConfig(session.orgId);
      const baseModel = await createModelFromConfig(llmConfig);
      const model = withRateLimit(baseModel);

      // ── LLM-based search: does any existing test cover this scenario? ──────
      // Rebuild the suite from the DB first (disk may be cold after a redeploy)
      // so existing tests are FOUND instead of being regenerated (wasting tokens).
      await ensureWorkspaceReady(id, workspace);

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

      // ── Generation: intent-driven journey OR single-page check ────────────
      let testFile: string;
      let testContent: string;
      let matchedTests: string[];

      const extractNames = (code: string): string[] => {
        const names: string[] = [];
        const re = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) names.push(m[1]);
        return names;
      };

      const isJourney = detectMultiStep(description) && siteMapPages.length > 0;
      let usedFlow = false;

      if (isJourney) {
        addLog(id, '🧭 Multi-step journey detected — extracting intent…', 'info');
        const steps = await extractIntent(description, siteMapPages, model);
        if (steps.length >= 2) {
          addLog(id, `📋 Plan (${steps.length} steps):`, 'info');
          steps.forEach((st, i) =>
            addLog(id, `  ${i + 1}. ${st.action}  →  expect: ${st.expected}`, 'info'));
          const code = await generateFlowTest({ description, steps, pages: siteMapPages, workspace, model });
          const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '').slice(0, 50) || 'flow';
          testFile = path.join(workspace.testsDir, `scenario-${slug}.spec.ts`);
          require('fs').writeFileSync(testFile, code, 'utf8');
          testContent = code;
          matchedTests = extractNames(code);
          usedFlow = true;
        } else {
          addLog(id, '  Intent extraction returned no plan — using single-page generator.', 'info');
          const gen = await generateScenarioTest({ description, workspace, model, siteMapPages });
          testFile = gen.testFile; testContent = gen.testContent; matchedTests = gen.matchedTests;
        }
      } else {
        if (siteMapPages.length > 0) {
          const top = findRelevantPages(description, siteMapPages, 1);
          if (top.length > 0) addLog(id, `🎯 Most relevant page: ${top[0].url} — "${top[0].title}"`, 'info');
        }
        const gen = await generateScenarioTest({ description, workspace, model, siteMapPages });
        testFile = gen.testFile; testContent = gen.testContent; matchedTests = gen.matchedTests;
      }

      // Add the new scenario spec to the persistent suite so it joins the
      // existing tests (instead of replacing the view) and survives redeploys.
      updateSession(id, { testFiles: workspace.testFiles() });
      await snapshotTestFiles(id, workspace);

      // The generated file is now part of the available list too
      const generatedEntry = {
        testFile,
        fileName: testFile.split('/').pop() ?? testFile,
        testNames: matchedTests,
      };
      const updatedAvailable = [
        ...findResult.allTests.filter(t => t.testFile !== testFile),
        generatedEntry,
      ];

      addLog(id, `📝 Generated ${usedFlow ? 'journey' : ''} test: ${generatedEntry.fileName}`, 'success');
      setScenarioResult(id, {
        ...initial,
        status: 'running',
        wasFound: false,
        testFile,
        testContent,
        matchedTests,
        availableTests: updatedAvailable,
      });

      // ── Run with capped self-refinement ───────────────────────────────────
      // On failure, the REAL run error is fed back to fix locators/waits ONLY —
      // refinements that weaken assertions are mechanically rejected.
      const MAX_REFINES = 3;
      const fileName = testFile.split('/').pop() ?? testFile;

      addLog(id, `▶ Running scenario test…`, 'info');
      let testResult = await runScenarioFile(workspace, testFile, id);
      await recordTestRun(id, testResult, { trigger: 'scenario', targetFile: fileName });

      let attempt = 0;
      while (testResult.stats.failed + testResult.stats.errors > 0 && attempt < MAX_REFINES) {
        attempt++;
        addLog(id, `🔧 Refine ${attempt}/${MAX_REFINES}: correcting from the real failure…`, 'info');
        const grounding = findRelevantPages(description, siteMapPages, 3);
        let refined: string;
        try {
          refined = await refineScenarioTest({
            code: testContent,
            errorOutput: testResult.output,
            pages: grounding.length > 0 ? grounding : siteMapPages.slice(0, 3),
            model,
          });
        } catch (refineErr) {
          addLog(id, `  Refinement failed (${refineErr instanceof Error ? refineErr.message : 'error'}) — stopping.`, 'error');
          break;
        }
        if (!refinementKeepsAssertions(testContent, refined)) {
          addLog(id, '  ✋ Refinement rejected — it weakened assertions. Keeping the original test.', 'error');
          break;
        }
        require('fs').writeFileSync(testFile, refined, 'utf8');
        testContent = refined;
        await snapshotTestFiles(id, workspace); // persists (and records previousContent)
        setScenarioResult(id, {
          ...initial,
          status: 'running',
          wasFound: false,
          testFile,
          testContent,
          matchedTests: extractNames(refined),
          availableTests: updatedAvailable,
        });
        addLog(id, `▶ Re-running (attempt ${attempt + 1})…`, 'info');
        testResult = await runScenarioFile(workspace, testFile, id);
        await recordTestRun(id, testResult, { trigger: 'scenario', targetFile: fileName });
      }

      const { passed, failed, total } = testResult.stats;
      const healthy = failed === 0 && testResult.stats.errors === 0;
      addLog(
        id,
        `${passed}/${total} passed${healthy ? ' ✅' : `, ${failed} failed`}` +
        (attempt > 0 ? ` (after ${attempt} refinement${attempt !== 1 ? 's' : ''})` : ''),
        healthy ? 'success' : 'error',
      );
      if (!healthy) {
        addLog(id, '⚠ Still failing after refinement — the app may not deliver this expectation (possible real bug). Check the recording.', 'error');
      }

      setScenarioResult(id, {
        description,
        status: 'done',
        wasFound: false,
        testFile,
        testContent,
        matchedTests: extractNames(testContent),
        availableTests: updatedAvailable,
        videos: testResult.videos,
        testResult,
        error: null,
      });
      // Merge into the existing suite result so the scenario ADDS to the totals
      // (old + new) rather than replacing what was already there.
      const prevSuite = getCachedSession(id)?.testResult ?? null;
      setTestResult(id, mergeTestResult(prevSuite, testResult, fileName));

      // Persist the scenario so it's listed for this session and re-usable for
      // the same target app in future sessions.
      await recordScenario({
        orgId: session.orgId,
        sessionId: id,
        url: session.url,
        description,
        testPath: require('path').relative(workspace.dir, testFile),
        lastStatus: healthy ? 'passed' : 'failed',
      });
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
      { cwd: workspace.dir, stdio: 'pipe', shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
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
      const { stats, cases } = parsePlaywrightReport(reportPath);

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

      resolve({ code: code ?? 1, duration, stats, output, videos, cases });
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
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  return NextResponse.json(session.scenarioResult ?? null);
}
