import { NextRequest, NextResponse } from 'next/server';
import {
  getSession, setStatus, setSiteMap, setTestResult, setFixResult,
  setError, addLog, updateSession, isStopping, clearStopping,
} from '@/lib/session-store';
import { runSiteExplorer, runGenerateSuite, Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { runTestsAsync } from '@/lib/run-tests-async';
import { fixTestsPerFile } from '@/lib/fix-tests-per-file';
import { SiteMap } from '@/types/session';
import { withRateLimit } from '@/lib/rate-limited-model';
import { getUrlContext, contextToEnv, contextToPromptHint } from '@/lib/url-context-store';
import { performPreLogin, patchPlaywrightConfigForAuth } from '@/lib/pre-login';
import { runAuthenticatedSiteExplorer } from '@/lib/authenticated-site-explorer';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (['exploring','generating','running','fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { maxIterations?: number };
  const maxIterations = body.maxIterations ?? 5;
  const maxPages = session.maxPages ?? 10;
  // Note: headedMode is intentionally NOT captured here — it is read fresh from the
  // session store before each test run so the user can toggle it during exploration/generation.

  addLog(id, `Starting full loop (max ${maxIterations} iterations)…`, 'info');

  (async () => {
    clearStopping(id);
    try {
      // rootDir is the parent; Workspace appends the URL slug to get workspace.dir
      const rootDir = path.join(process.cwd(), '.testpilot', id);
      const workspace = new Workspace({ url: session.url, rootDir });
      workspace.init();

      // Phase 0: Pre-login (only if context with values exists for this URL)
      const urlCtx = getUrlContext(session.url);
      let exploreStartUrl = session.url;
      let authFile: string | null = null;

      if (urlCtx && urlCtx.fields.some(f => f.value)) {
        addLog(id, 'Context detected — attempting pre-login before exploration…', 'info');
        const loginResult = await performPreLogin(
          session.url,
          urlCtx.fields,
          workspace.dir,
          (line) => addLog(id, line, 'info'),
        );
        if (loginResult.success) {
          // Start exploration from the site's origin URL, not the exact post-login path.
          // The auth cookies in storageState handle the redirect to the authenticated
          // home page automatically. Using the deep path (e.g. /inventory.html) risks
          // a 404 if the session expires between pre-login and exploration.
          try {
            exploreStartUrl = new URL(loginResult.postLoginUrl).origin;
          } catch {
            exploreStartUrl = loginResult.postLoginUrl;
          }
          authFile = loginResult.authFile;
          addLog(id, `Pre-login succeeded. Exploration will start from: ${exploreStartUrl}`, 'success');
        } else {
          addLog(id, `Pre-login failed: ${loginResult.error ?? 'unknown error'}. Exploring from the original URL.`, 'error');
        }
      }

      // Phase 1: Explore
      // When pre-login succeeded we use our own authenticated crawler (storageState loaded).
      // Otherwise fall back to the standard runSiteExplorer.
      setStatus(id, 'exploring');
      addLog(id, 'Phase 1: Exploring site…', 'info');
      let siteMap: SiteMap;
      if (authFile && existsSync(authFile)) {
        addLog(id, 'Using authenticated browser for site exploration…', 'info');
        siteMap = await runAuthenticatedSiteExplorer({
          url: exploreStartUrl,
          authFile,
          depth: 2,
          maxPages,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
        }) as unknown as SiteMap;
      } else {
        siteMap = await runSiteExplorer({
          url: exploreStartUrl,
          depth: 2,
          maxPages,
          writeSiteMap: true,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
        });
      }
      setSiteMap(id, siteMap as unknown as SiteMap);
      addLog(id, `Found ${siteMap.total_pages} pages.`, 'success');

      // Phase 2: Generate
      setStatus(id, 'generating');
      addLog(id, 'Phase 2: Generating tests…', 'info');
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);
      await workspace.installDeps();

      // ── Inject stored URL context into the workspace ────────────────────
      // Context fields are written to .env so Playwright picks them up,
      // and a CONTEXT.md is written so Claude can reference them when writing tests.
      // urlCtx was already fetched above (pre-login phase)
      if (urlCtx && urlCtx.fields.some(f => f.value)) {
        addLog(id, `Injecting context: ${urlCtx.fields.filter(f => f.value).length} field(s) configured.`, 'info');

        // Write .env file (Playwright automatically loads this during test runs)
        const envVars = contextToEnv(urlCtx);
        const envPath = path.join(workspace.dir, '.env');
        const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        const newEntries = Object.entries(envVars)
          .filter(([k]) => !existingEnv.includes(k + '='))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n');
        if (newEntries) {
          writeFileSync(envPath, existingEnv + (existingEnv.endsWith('\n') ? '' : '\n') + newEntries + '\n', 'utf8');
        }

        // Write CONTEXT.md so Claude's test generator can read the hint
        const hint = contextToPromptHint(urlCtx);
        if (hint) {
          writeFileSync(path.join(workspace.dir, 'CONTEXT.md'), `# Test Context\n\n${hint}\n`, 'utf8');
        }

        // Patch playwright.config.ts to use auth.json if pre-login succeeded
        patchPlaywrightConfigForAuth(workspace.dir);
      }

      // Forward console.log output from the generator to the session log
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        origLog(...args);
        const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
        addLog(id, msg, msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') ? 'error' : 'info');
      };
      try {
        await runGenerateSuite({
          skipExplore: true,
          depth: 2,
          maxPages,
          model: llmConfig.model,
          chatModel,
          workspace,
        });
      } finally {
        console.log = origLog;
      }
      const testFiles = workspace.testFiles();
      updateSession(id, { testFiles });
      addLog(id, `Generated ${testFiles.length} test file(s).`, 'success');

      // Phase 3-N: Run → Fix loop
      for (let i = 1; i <= maxIterations; i++) {
        if (isStopping(id)) { addLog(id, 'Stopped by user.', 'info'); break; }
        updateSession(id, { iteration: i });
        setStatus(id, 'running');
        addLog(id, `Iteration ${i}: Running tests…`, 'info');
        // Read headedMode fresh so toggling during explore/generate is respected
        const headed = getSession(id)?.headedMode ?? false;
        const result = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, headed);
        setTestResult(id, result);

        const { passed, failed, total, errors } = result.stats;
        if (errors > 0 && total === 0) {
          addLog(id, `Test run failed — syntax error or no tests found. Stopping.`, 'error');
          break;
        }
        addLog(id, `${passed}/${total} passed, ${failed} failed.`, failed === 0 ? 'success' : 'error');

        if (failed === 0) {
          addLog(id, 'All tests passing! Loop complete.', 'success');
          break;
        }

        if (i < maxIterations) {
          if (isStopping(id)) { addLog(id, 'Stopped by user.', 'info'); break; }
          setStatus(id, 'fixing');
          addLog(id, `Iteration ${i}: Auto-fixing failures…`, 'info');
          const fixResult = await fixTestsPerFile(workspace, chatModel, (line) => addLog(id, line, 'info'), id);
          setFixResult(id, fixResult);
          addLog(
            id,
            fixResult.fixed ? `Fixed ${fixResult.filesChanged} file(s).` : 'No fixes applied.',
            fixResult.fixed ? 'success' : 'info',
          );
          if (!fixResult.fixed) {
            addLog(id, 'No progress made, stopping early.', 'info');
            break;
          }
        }
      }

      setStatus(id, 'idle');
      addLog(id, '✅ Session complete.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(id, msg);
      addLog(id, `Loop failed: ${msg}`, 'error');
    } finally {
      clearStopping(id);
    }
  })();

  return NextResponse.json({ started: true });
}
