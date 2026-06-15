/**
 * Self-heal agent (E2) — an iterative observe → act → verify loop, the autonomous
 * upgrade to single-shot healing.
 *
 * For each healable failing test it: reads the current test block + the latest
 * error + the feature's intended behavior (app context), asks the model for ONE
 * targeted fix, splices it in, then RE-RUNS only that test (--grep) to verify.
 * It repeats until the test goes green, the error stops changing (no progress),
 * or the per-test attempt budget is spent. Assertions are never weakened to pass.
 *
 * Gated behind the `healMode: 'agent'` org setting (default single-shot) so it's
 * opt-in and directly comparable. Skips app_bug / setup_error (handled upstream).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ChatModel } from '@/lib/pilot';
import { Workspace } from '@/lib/pilot';
import { isStopping } from '@/lib/session-store';
import { runTestsAsync } from '@/lib/run-tests-async';
import { locateTestBlock, isValidBlock } from '@/lib/fix-tests-per-file';

export interface HealableFailure { file: string; title: string; error: string }

export interface HealAgentOptions {
  workspace: Workspace;
  model: ChatModel;
  failures: HealableFailure[];
  appContext?: string;
  maxAttempts?: number;   // per test (default 3)
  maxTests?: number;      // bound cost per run (default 15)
  sessionId?: string;
  onProgress?: (line: string) => void;
}

export interface HealAgentResult {
  fixed: boolean;
  filesChanged: number;
  healed: number;     // tests that went green
  attempted: number;  // tests the agent worked on
}

/** Did `title` pass in the just-produced run report? */
function testPassed(cases: Record<string, 'passed' | 'failed' | 'skipped'> | undefined, title: string): boolean {
  if (!cases) return false;
  for (const [key, status] of Object.entries(cases)) {
    if (key.endsWith(` › ${title}`) || key === title) return status === 'passed';
  }
  return false;
}

async function proposeFix(
  model: ChatModel, file: string, title: string, block: string, error: string, appContext: string,
): Promise<string | null> {
  const raw = await model.invoke(
    [
      { role: 'system', content: 'You are a Playwright engineer. Respond with ONLY valid JSON — no markdown, no prose.' },
      {
        role: 'user',
        content:
          `A single Playwright test is FAILING. Return ONE corrected test(...) block (from "test(" ` +
          `through its closing "});"), keeping the EXACT same title. Fix how it targets the app — ` +
          `selector, wait, or a wrong expected value. Do NOT weaken or delete a meaningful assertion ` +
          `to make it pass.\n\n` +
          (appContext ? `${appContext}\nHeal toward the intended behavior above.\n\n` : '') +
          `FILE: ${file}\nTITLE: ${title}\n\nLATEST ERROR:\n${error.slice(0, 700)}\n\n` +
          `CURRENT BLOCK:\n${block}\n\n` +
          `Respond with ONLY JSON: {"code":"<full corrected test(...) block>"}`,
      },
    ],
    { maxTokens: 4_096 },
  );
  try {
    const parsed = JSON.parse(raw.replace(/```(?:json)?\n?/g, '').trim()) as { code?: string };
    return parsed.code && isValidBlock(parsed.code) ? parsed.code.trim() : null;
  } catch {
    return null;
  }
}

export async function healWithAgent(opts: HealAgentOptions): Promise<HealAgentResult> {
  const { workspace, model, appContext = '', sessionId, onProgress } = opts;
  const maxAttempts = opts.maxAttempts ?? 3;
  const targets = opts.failures.slice(0, opts.maxTests ?? 15);

  let filesChanged = 0, healed = 0, attempted = 0;
  const changedFiles = new Set<string>();

  for (const f of targets) {
    if (sessionId && isStopping(sessionId)) { onProgress?.('Stopped by user.'); break; }
    // Triage reports the file as "tests/x.spec.ts" or a bare basename — accept both.
    const fullPath = [
      path.join(workspace.dir, f.file),
      path.join(workspace.testsDir, path.basename(f.file)),
    ].find(existsSync);
    if (!fullPath) { onProgress?.(`  ⚠ ${f.file} not on disk — skipping`); continue; }

    attempted++;
    let lastError = f.error;
    let done = false;
    onProgress?.(`🤖 Healing "${f.title}" (up to ${maxAttempts} attempts)…`);

    for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
      if (sessionId && isStopping(sessionId)) break;

      const content = readFileSync(fullPath, 'utf8');
      const loc = locateTestBlock(content, f.title);
      if (!loc) { onProgress?.(`  ⚠ could not locate "${f.title}" — skipping`); break; }

      const block = content.slice(loc.start, loc.end);
      const fix = await proposeFix(model, f.file, f.title, block, lastError, appContext).catch(() => null);
      if (!fix) { onProgress?.(`  ⚠ attempt ${attempt}: no safe fix produced`); break; }

      // Act — splice the corrected block back in.
      writeFileSync(fullPath, content.slice(0, loc.start) + fix + content.slice(loc.end), 'utf8');
      changedFiles.add(f.file);

      // Verify — re-run ONLY this test.
      const res = await runTestsAsync(workspace, undefined, sessionId, false, f.title);
      if (testPassed(res.cases, f.title)) {
        onProgress?.(`  ✓ healed on attempt ${attempt}`);
        healed++; done = true;
        break;
      }

      // No progress guard: same error twice → stop wasting attempts on this test.
      const newError = (res.output || '').slice(0, 700) || lastError;
      const sig = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);
      if (sig(newError) === sig(lastError)) { onProgress?.(`  • attempt ${attempt}: no change in the error — stopping this test`); break; }
      lastError = newError;
      onProgress?.(`  • attempt ${attempt}: still failing — retrying with the new error`);
    }
  }

  filesChanged = changedFiles.size;
  if (attempted === 0) onProgress?.('No healable failures for the agent.');
  else onProgress?.(`🤖 Agent healed ${healed}/${attempted} test(s) across ${filesChanged} file(s).`);
  return { fixed: healed > 0, filesChanged, healed, attempted };
}
