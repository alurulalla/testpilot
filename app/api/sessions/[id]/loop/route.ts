import { NextRequest, NextResponse } from 'next/server';
import {
  getSession, setStatus, setSiteMap, setTestResult, setFixResult,
  setTriageResult, setError, addLog, updateSession, isStopping, clearStopping,
} from '@/lib/session-store';
import { runSiteExplorer, runGenerateSuite, Workspace } from '@/lib/pilot';
import { reviewGeneratedTests } from '@/lib/review-tests';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { runTestsAsync } from '@/lib/run-tests-async';
import { fixTestsPerFile, fixSyntaxErrors } from '@/lib/fix-tests-per-file';
import { triageFailures } from '@/lib/triage-failures';
import { SiteMap } from '@/types/session';
import { withRateLimit } from '@/lib/rate-limited-model';
import { getUrlContext, saveUrlContext, contextToEnv, contextToPromptHint } from '@/lib/url-context-store';
import { getSessionDir } from '@/lib/config';
import { extractCredentialsFromDoc } from '@/lib/extract-credentials-from-doc';
import { performPreLogin, patchPlaywrightConfigForAuth } from '@/lib/pre-login';
import { runAuthenticatedSiteExplorer } from '@/lib/authenticated-site-explorer';
import { writeContextMd } from '@/lib/build-context-md';
import { compareCrawlToDocs } from '@/lib/compare-crawl-to-docs';
import { getDeepCrawlMaxPages } from '@/lib/config';
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

    // Helper — call after any awaited phase.  Returns true and cleans up when
    // the user has clicked Stop so the caller can `return` immediately.
    const stopped = (phase?: string): boolean => {
      if (!isStopping(id)) return false;
      addLog(id, phase ? `Stopped by user (after ${phase}).` : 'Stopped by user.', 'info');
      setStatus(id, 'idle');
      clearStopping(id);
      return true;
    };

    try {
      // rootDir is the parent; Workspace appends the URL slug to get workspace.dir
      const rootDir = getSessionDir(id);
      const workspace = new Workspace({ url: session.url, rootDir });
      workspace.init();

      // Phase 0: Pre-login (only if context with values exists for this URL)
      // Auto-extract credentials from product documentation when no context is
      // saved yet — this means the user can supply a doc with embedded credentials
      // (e.g. "Username: standard_user / Password: secret_sauce") and TestPilot
      // will discover them automatically without a manual credentials entry step.
      const docForExtraction = getSession(id)?.contextDoc ?? null;
      if (docForExtraction && !getUrlContext(session.url)?.fields.some(f => f.value)) {
        const extracted = extractCredentialsFromDoc(docForExtraction);
        if (extracted) {
          addLog(id, `📋 Found credentials in product documentation (${extracted.usernameLabel}: ${extracted.username}) — saving for pre-login.`, 'info');
          saveUrlContext(session.url, [
            { key: 'username', label: extracted.usernameLabel, type: 'text',     value: extracted.username, sensitive: false },
            { key: 'password', label: 'Password',              type: 'password', value: extracted.password, sensitive: true  },
          ]);
        }
      }

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

          // Persist login page details to workspace .env so the generator can
          // produce an accurate login() helper without guessing selectors.
          if (loginResult.loginPageInfo) {
            const { url: loginUrl, usernameSelector, submitButtonText } = loginResult.loginPageInfo;
            const loginEnv =
              `TESTPILOT_LOGIN_URL=${loginUrl}\n` +
              `TESTPILOT_LOGIN_USERNAME_SELECTOR=${usernameSelector}\n` +
              `TESTPILOT_LOGIN_SUBMIT_TEXT=${submitButtonText}\n`;
            const envPath = path.join(rootDir, workspace.slug, '.env');
            const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
            // Only append keys that aren't already present
            const toAdd = loginEnv.split('\n')
              .filter(l => l && !existingEnv.includes(l.split('=')[0] + '='))
              .join('\n');
            if (toAdd) writeFileSync(envPath, existingEnv + (existingEnv.endsWith('\n') ? '' : '\n') + toAdd + '\n', 'utf8');
          }
        } else {
          addLog(id, `Pre-login failed: ${loginResult.error ?? 'unknown error'}. Exploring from the original URL.`, 'error');
        }
      }

      // Model and deps are needed in all modes (run / fix / triage always use LLM)
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const chatModel = withRateLimit(baseModel);
      await workspace.installDeps();

      // ── Imported project fast path ──────────────────────────────────────────
      // When the user uploaded an existing Playwright ZIP, the spec files are
      // already in the workspace. Skip exploration and generation entirely —
      // go straight to the run → triage → fix loop.
      const isImportMode = Boolean(getSession(id)?.importedProject) && workspace.testFiles().length > 0;

      if (isImportMode) {
        addLog(id, '📦 Imported Playwright project — skipping exploration and generation, running existing tests.', 'info');
        // Synthesise a minimal siteMap so the Explore phase appears done in the UI
        if (!getSession(id)?.siteMap) {
          setSiteMap(id, {
            start_url: session.url,
            total_pages: 1,
            pages: [{ url: session.url, depth: 0, title: 'Imported project', status_code: 200, elements: {}, child_urls: [], screenshot: '', error: null }],
          } as SiteMap);
        }
        updateSession(id, { testFiles: workspace.testFiles() });
        addLog(id, `${workspace.testFiles().length} imported test file(s) ready.`, 'success');
      } else {

      // Phase 1: Explore
      // When pre-login succeeded:
      //  - Use our authenticated crawler (storageState loaded)
      //  - Switch to deep-crawl mode: more pages + greater depth so we reach
      //    protected routes that are invisible to unauthenticated browsers.
      setStatus(id, 'exploring');
      const isAuthenticatedCrawl = Boolean(authFile && existsSync(authFile));
      const crawlMaxPages  = isAuthenticatedCrawl ? getDeepCrawlMaxPages() : maxPages;
      const crawlDepth     = isAuthenticatedCrawl ? 3 : 2;

      if (isAuthenticatedCrawl) {
        addLog(id, `Phase 1: Deep authenticated crawl (up to ${crawlMaxPages} pages, depth ${crawlDepth})…`, 'info');
      } else {
        addLog(id, 'Phase 1: Exploring site…', 'info');
      }

      let siteMap: SiteMap;
      if (isAuthenticatedCrawl) {
        addLog(id, 'Using authenticated browser for site exploration…', 'info');
        siteMap = await runAuthenticatedSiteExplorer({
          url: exploreStartUrl,
          authFile: authFile!,
          depth: crawlDepth,
          maxPages: crawlMaxPages,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
        }) as unknown as SiteMap;
      } else {
        siteMap = await runSiteExplorer({
          url: exploreStartUrl,
          depth: crawlDepth,
          maxPages: crawlMaxPages,
          writeSiteMap: true,
          outputDir: workspace.dir,
          onProgress: (line: string) => addLog(id, line, 'info'),
        });
      }
      setSiteMap(id, siteMap as unknown as SiteMap);
      addLog(id, `Found ${siteMap.total_pages} page(s).`, 'success');
      if (stopped('explore')) return;

      // Phase 1.5: Compare crawled content against product documentation
      // This tells us which documented features were visible in the crawl
      // and which might be behind login, missing, or on uncrawled pages.
      const freshDocSession = getSession(id);
      if (freshDocSession?.contextDoc) {
        try {
          const docComparison = compareCrawlToDocs(siteMap, freshDocSession.contextDoc);
          if (docComparison.total > 0) {
            addLog(id, `Phase 1.5: Comparing crawl against documentation (${docComparison.total} feature(s))…`, 'info');
            if (docComparison.covered.length > 0) {
              addLog(id, `  ✓ ${docComparison.covered.length} feature(s) confirmed in crawl: ${docComparison.covered.slice(0, 5).join(', ')}${docComparison.covered.length > 5 ? '…' : ''}`, 'success');
            }
            if (docComparison.missing.length > 0) {
              addLog(
                id,
                `  ⚠ ${docComparison.missing.length} feature(s) from docs not found in crawl` +
                (isAuthenticatedCrawl ? '' : ' — these may be behind authentication') +
                `: ${docComparison.missing.join(', ')}`,
                'info',
              );
              if (!isAuthenticatedCrawl && docComparison.missing.length > 0) {
                addLog(id, '  💡 Tip: Add login credentials on the prepare page to enable a deeper authenticated crawl.', 'info');
              }
            }
          }
        } catch {
          // Non-fatal — comparison is advisory only
        }
      }

      if (stopped('doc comparison')) return;

      // Phase 2: Generate
      setStatus(id, 'generating');
      addLog(id, 'Phase 2: Generating tests…', 'info');

      // ── Write CONTEXT.md (product doc + user flows + credentials) ────────
      // Re-fetch to pick up any contextDoc/userFlows saved between session
      // creation and the loop starting (e.g. uploaded on the prepare page).
      const freshSession = getSession(id);
      const hasDoc      = Boolean(freshSession?.contextDoc);
      const hasFlows    = (freshSession?.userFlows?.length ?? 0) > 0;
      const hasImported = Boolean(freshSession?.importedProject);

      if (hasDoc || hasFlows || hasImported) {
        const importedLog = hasImported
          ? `, ${freshSession!.importedProject!.useCases.reduce((n, u) => n + u.tests.length, 0)} imported test case(s)`
          : '';
        addLog(id, `Writing context to workspace (${freshSession!.contextDoc?.length ?? 0} chars, ${freshSession!.userFlows?.length ?? 0} flow(s)${importedLog})…`, 'info');
        writeContextMd(
          workspace.dir,
          freshSession!.contextDoc ?? null,
          freshSession!.userFlows ?? [],
          freshSession!.importedProject ?? null,
        );
      }

      // ── Inject stored URL context into the workspace ─────────────────────
      // Context fields are written to .env so Playwright picks them up.
      // Credential hints are appended to CONTEXT.md so Claude sees them too.
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

        // Append credential hint to CONTEXT.md (after any product doc already written)
        const hint = contextToPromptHint(urlCtx);
        if (hint) {
          const contextPath = path.join(workspace.dir, 'CONTEXT.md');
          const existing = existsSync(contextPath) ? readFileSync(contextPath, 'utf8').trimEnd() : '';
          const section = '\n\n---\n\n# Test Credentials & Context\n\n' + hint;
          writeFileSync(contextPath, (existing || '') + section + '\n', 'utf8');
        }

        // NOTE: We intentionally do NOT apply storageState globally here.
        // Setting storageState on every test would break login-page tests
        // (the app redirects authenticated users away from the login form).
        // Tests that need authentication call login() explicitly via fixtures.ts.
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
      if (stopped('generate')) return;

      // Phase 2.5: Review generated tests against crawled elements
      // Static-checks every getByRole locator against the interactives index;
      // only calls the LLM for files that have unmatched locators.
      addLog(id, 'Phase 2.5: Reviewing generated tests against crawled elements…', 'info');
      try {
        const reviewResult = await reviewGeneratedTests(
          workspace,
          chatModel,
          (line) => addLog(id, line, 'info'),
        );
        if (reviewResult.fixed > 0) {
          addLog(id, `Review complete — corrected ${reviewResult.fixed} of ${reviewResult.reviewed} file(s).`, 'success');
          // Refresh test file list so corrected files are reflected in the UI
          updateSession(id, { testFiles: workspace.testFiles() });
        } else {
          addLog(id, `Review complete — all ${reviewResult.reviewed} file(s) passed locator check.`, 'success');
        }
      } catch (reviewErr) {
        // Non-fatal — review failure never blocks test execution
        addLog(id, `Phase 2.5 review error (non-fatal): ${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}`, 'error');
      }
      if (stopped('review')) return;

      } // end !isImportMode (explore + generate phases)

      // Read AUTO_SELF_HEAL at loop start so it can be changed via env without restart
      const autoSelfHeal = process.env.AUTO_SELF_HEAL === 'true';
      if (!autoSelfHeal) {
        addLog(id, 'ℹ Auto-heal is OFF (AUTO_SELF_HEAL is not set). Self-healing must be triggered manually.', 'info');
      }

      // Phase 3-N: Run → Triage → (optionally) Fix loop
      for (let i = 1; i <= maxIterations; i++) {
        if (stopped()) return;
        updateSession(id, { iteration: i });
        setStatus(id, 'running');
        setTriageResult(id, null); // clear stale triage on each iteration
        addLog(id, `Iteration ${i}: Running tests…`, 'info');
        // Read headedMode fresh so toggling during explore/generate is respected
        const headed = getSession(id)?.headedMode ?? false;
        const result = await runTestsAsync(workspace, (line) => addLog(id, line, 'info'), id, headed);
        setTestResult(id, result);
        if (stopped('test run')) return;

        const { passed, failed, total, errors } = result.stats;
        if (errors > 0 && total === 0) {
          addLog(id, 'Test run failed — syntax error or no tests found. Attempting auto-heal…', 'error');
          setStatus(id, 'fixing');
          const syntaxFixed = await fixSyntaxErrors(
            workspace,
            result.output,
            chatModel,
            (line) => addLog(id, line, 'info'),
          ).catch(() => false);
          if (!syntaxFixed) {
            addLog(id, 'Could not auto-heal syntax errors. Stopping.', 'error');
            break;
          }
          addLog(id, 'Syntax errors fixed — retrying tests…', 'success');
          // Update file list after fixes and retry this iteration
          updateSession(id, { testFiles: workspace.testFiles() });
          i -= 1; // don't consume an iteration slot for a syntax-error retry
          continue;
        }
        addLog(id, `${passed}/${total} passed, ${failed} failed.`, failed === 0 ? 'success' : 'error');

        if (failed === 0) {
          addLog(id, 'All tests passing! Loop complete.', 'success');
          break;
        }

        // Triage failures — always, regardless of AUTO_SELF_HEAL
        addLog(id, `Iteration ${i}: Analysing failures…`, 'info');
        const triage = await triageFailures(
          workspace,
          getSession(id)?.contextDoc ?? null,
          getSession(id)?.url ?? session.url,
          chatModel,
          (line) => addLog(id, line, 'info'),
        ).catch(() => null);
        if (stopped('triage')) return;

        if (triage) {
          setTriageResult(id, triage);
          if (triage.appBugCount > 0) {
            addLog(
              id,
              `⚠ ${triage.appBugCount} failure(s) are application bugs — the app may not match its documentation.`,
              'error',
            );
          }
        }

        // If AUTO_SELF_HEAL is OFF, stop here — let the user decide what to do
        if (!autoSelfHeal) {
          addLog(
            id,
            triage?.selfHealRecommended
              ? `Self-healing is available for ${(triage.testBugCount ?? 0) + (triage.ambiguousCount ?? 0)} test-code issue(s). Click "Self-Heal" to fix.`
              : 'No healable test-code issues found.',
            'info',
          );
          break; // exit the loop — user triggers fix manually
        }

        // AUTO_SELF_HEAL is ON — but only if there are healable failures
        if (!triage?.selfHealRecommended) {
          addLog(id, 'All remaining failures are application bugs. Stopping auto-heal loop.', 'info');
          break;
        }

        if (i < maxIterations) {
          if (stopped()) return;
          setStatus(id, 'fixing');
          addLog(id, `Iteration ${i}: Auto-fixing healable failures…`, 'info');
          const fixResult = await fixTestsPerFile(
            workspace, chatModel, (line) => addLog(id, line, 'info'), id, triage?.analyses,
          );
          setFixResult(id, { fixed: fixResult.fixed, filesChanged: fixResult.filesChanged });
          addLog(
            id,
            fixResult.fixed ? `Fixed ${fixResult.filesChanged} file(s).` : 'No fixes applied.',
            fixResult.fixed ? 'success' : 'info',
          );
          if (stopped('fix')) return;
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
