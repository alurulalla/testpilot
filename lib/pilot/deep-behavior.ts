/**
 * Agentic deep-behavior generation (Phase 5 — OPT-IN, off by default).
 *
 * The crawl-driven generator can only assert what a STATIC snapshot reveals
 * ("this control exists"). It cannot know what a control DOES — that requires
 * interacting with the live app. This module runs a bounded observe→act→verify
 * agent against the CRITICAL features in the app profile: it clicks/fills, sees
 * what changed (URL, revealed elements), and emits a test whose assertions are
 * grounded in the observed behavior — closing the "control exists vs control
 * works" gap without requiring product docs.
 *
 * It is deliberately expensive (live browser + multiple LLM round-trips), so it
 * is gated behind OrgSettings.deepBehavior and bounded on every axis:
 *   • only CRITICAL profile features (capped at maxFeatures)
 *   • a hard step cap per feature (observe→act→verify iterations)
 *   • a soft token budget — no NEW feature is started once it is exceeded
 *   • ONE reused browser/context (never relaunch per action — that is what
 *     exhausted the server's thread limit) and full Stop-button support
 *   • destructive controls (delete/logout/pay/submit-order…) are never clicked
 */
import path from 'path';
import { writeFileSync } from 'fs';
import type { BrowserContext, Page } from 'playwright';
import { launchBrowser } from '@/lib/browser';
import { withTokenCounter, StopError } from '@/lib/token-counter';
import { getAppProfile } from '@/lib/app-profile';
import type { ChatModel } from './types';
import type { Workspace } from './workspace';

const NAV_TIMEOUT = 20_000;
const ACT_TIMEOUT = 5_000;
const DESTRUCTIVE_RE =
  /\b(delete|remove|logout|log\s?out|sign\s?out|deactivate|unsubscribe|pay|buy\s?now|purchase|place\s?order|checkout|confirm|submit|reset|clear\s?all|destroy|terminate)\b/i;

export interface DeepBehaviorOptions {
  orgId: string;
  host: string;
  startUrl: string;
  workspace: Workspace;
  model: ChatModel;
  authFile?: string | null;
  maxFeatures?: number;        // default 3
  maxStepsPerFeature?: number; // default 6
  tokenBudget?: number;        // default 60_000 (in+out); stop starting features past this
  onProgress?: (line: string) => void;
  shouldStop?: () => boolean;
}

export interface DeepBehaviorResult {
  filesWritten: string[];
  featuresExplored: number;
}

interface ProposedAction {
  thought?: string;
  action: 'click' | 'fill' | 'goto' | 'finish';
  role?: string;
  name?: string;
  value?: string;
  path?: string;
}

interface StepRecord {
  action: string;
  detail: string;
  beforeUrl: string;
  afterUrl: string;
  note: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'feature';
}

function firstJson(raw: string): Record<string, unknown> | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

/** Compact, token-cheap snapshot of the current page for the agent prompt. */
async function observe(page: Page): Promise<string> {
  const snap = await page.evaluate(() => {
    const vis = (el: Element) => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    };
    const txt = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const seen = new Set<string>();
    const controls: string[] = [];
    for (const el of Array.from(document.querySelectorAll('a,button,input,select,[role=button],[role=link],[role=tab]'))) {
      if (!vis(el)) continue;
      const role = el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button'
        : el.tagName === 'INPUT' ? 'input' : (el.getAttribute('role') ?? el.tagName.toLowerCase());
      const name = txt(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
      if (!name) continue;
      const key = `${role}:${name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push(`${role} "${name}"`);
      if (controls.length >= 35) break;
    }
    const headings = Array.from(document.querySelectorAll('h1,h2'))
      .filter(vis).map(txt).filter(Boolean).slice(0, 6);
    return { headings, controls };
  }).catch(() => ({ headings: [] as string[], controls: [] as string[] }));

  return `URL: ${page.url()}\nHEADINGS: ${snap.headings.join(' | ') || '(none)'}\nCONTROLS:\n${snap.controls.map(c => '  ' + c).join('\n') || '  (none)'}`;
}

/** Ask the model for the next single action toward exercising the feature. */
async function nextAction(
  model: ChatModel, featureName: string, journeys: string[], outcomes: string[],
  pageState: string, history: StepRecord[],
): Promise<ProposedAction | null> {
  const hist = history.length
    ? history.map((s, i) => `  ${i + 1}. ${s.action} ${s.detail} → ${s.note}`).join('\n')
    : '  (none yet)';
  const raw = await model.invoke(
    [
      { role: 'system', content:
        'You drive a real browser to exercise ONE app feature, one action at a time. ' +
        'Respond with ONLY a JSON object: ' +
        '{"thought":string,"action":"click"|"fill"|"goto"|"finish","role"?:string,"name"?:string,"value"?:string,"path"?:string}. ' +
        'Use role+name from the CONTROLS list verbatim. Choose "finish" once the journey is exercised or no useful action remains. ' +
        'Never attempt destructive actions (delete, logout, pay, submit order).' },
      { role: 'user', content:
        `FEATURE: ${featureName}\nJOURNEYS:\n${journeys.map(j => '  - ' + j).join('\n') || '  (none)'}\n` +
        `EXPECTED OUTCOMES:\n${outcomes.map(o => '  - ' + o).join('\n') || '  (none)'}\n\n` +
        `CURRENT PAGE:\n${pageState}\n\nACTIONS SO FAR:\n${hist}\n\nNext action as JSON:` },
    ],
    { maxTokens: 400 },
  );
  const parsed = firstJson(raw);
  if (!parsed || typeof parsed.action !== 'string') return null;
  return parsed as unknown as ProposedAction;
}

/** Execute one proposed action; returns a short note on what happened. */
async function act(page: Page, a: ProposedAction): Promise<string> {
  const label = `${a.role ?? ''} "${a.name ?? a.path ?? ''}"`;
  if ((a.action === 'click' || a.action === 'fill') && a.name && DESTRUCTIVE_RE.test(a.name)) {
    return `refused destructive action on ${label}`;
  }
  try {
    if (a.action === 'goto' && a.path) {
      await page.goto(a.path, { waitUntil: 'load', timeout: NAV_TIMEOUT });
      return `navigated to ${a.path}`;
    }
    if (a.action === 'click' && a.name) {
      await page.getByRole((a.role || 'link') as Parameters<Page['getByRole']>[0], { name: a.name }).first()
        .click({ timeout: ACT_TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      return `clicked ${label}`;
    }
    if (a.action === 'fill' && a.name) {
      await page.getByRole((a.role || 'textbox') as Parameters<Page['getByRole']>[0], { name: a.name }).first()
        .fill(a.value ?? 'test', { timeout: ACT_TIMEOUT });
      return `filled ${label} with "${a.value ?? 'test'}"`;
    }
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  }
  return 'no-op';
}

/** Turn the observed step log into a grounded Playwright spec file. */
async function emitSpec(
  model: ChatModel, featureName: string, outcomes: string[], steps: StepRecord[],
): Promise<string | null> {
  const log = steps.map((s, i) =>
    `  ${i + 1}. ${s.action} ${s.detail}\n     before: ${s.beforeUrl}\n     after:  ${s.afterUrl}\n     result: ${s.note}`,
  ).join('\n');
  const raw = await model.invoke(
    [
      { role: 'system', content:
        'You write ONE Playwright test (TypeScript) from an OBSERVED interaction log. ' +
        "Import: import { test, expect } from './fixtures.js'. " +
        'Replay only the actions that SUCCEEDED, and assert the OBSERVED outcomes: when the URL changed, ' +
        'assert toHaveURL on the observed after-URL; when an action revealed content, assert it toBeVisible. ' +
        'ASSERTION RULES: never locate by an attribute and assert that same attribute; use toBeVisible for ' +
        'user-facing elements; after a click assert the OUTCOME, never re-assert the clicked control. ' +
        'Ground every assertion in the log — invent nothing. Return ONLY the TypeScript file, no fences.' },
      { role: 'user', content:
        `FEATURE: ${featureName}\nEXPECTED OUTCOMES:\n${outcomes.map(o => '  - ' + o).join('\n') || '  (none)'}\n\n` +
        `OBSERVED INTERACTION LOG:\n${log}\n\nWrite the test file:` },
    ],
    { maxTokens: 1_500 },
  );
  const m = raw.match(/import[\s\S]*/);
  const code = (m ? m[0] : raw).trim();
  return code.includes('test(') && code.includes('expect(') ? code : null;
}

export async function generateDeepBehaviorTests(opts: DeepBehaviorOptions): Promise<DeepBehaviorResult> {
  const {
    orgId, host, startUrl, workspace, authFile,
    maxFeatures = 3, maxStepsPerFeature = 6, tokenBudget = 60_000,
    onProgress, shouldStop,
  } = opts;
  const log = (m: string) => onProgress?.(m);
  const model = withTokenCounter(opts.model);
  const result: DeepBehaviorResult = { filesWritten: [], featuresExplored: 0 };

  const profile = await getAppProfile(orgId, host).catch(() => null);
  if (!profile) { log('  deep-behavior: no app profile — skipping'); return result; }

  // Prefer critical features; fall back to the most central normal ones.
  const critical = profile.features.filter(f => f.criticality === 'critical' && !f.quarantined);
  const chosen = (critical.length ? critical : profile.features.filter(f => !f.quarantined))
    .slice(0, maxFeatures);
  if (chosen.length === 0) { log('  deep-behavior: no features to exercise — skipping'); return result; }

  log(`🧭 Deep-behavior: exercising ${chosen.length} ${critical.length ? 'critical ' : ''}feature(s) live (cap ${maxStepsPerFeature} steps each)…`);

  const browser = await launchBrowser();
  let ctx: BrowserContext | null = null;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...(authFile ? { storageState: authFile } : {}),
    });
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);

    for (const feature of chosen) {
      if (shouldStop?.()) throw new StopError();
      const used = model.getUsage();
      if (used.input + used.output > tokenBudget) {
        log(`  deep-behavior: token budget reached (${used.input + used.output}) — stopping before "${feature.name}"`);
        break;
      }

      const page = await ctx.newPage();
      const steps: StepRecord[] = [];
      try {
        await page.goto(startUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
        for (let step = 0; step < maxStepsPerFeature; step++) {
          if (shouldStop?.()) throw new StopError();
          const state = await observe(page);
          const a = await nextAction(model, feature.name, feature.journeys, feature.expectedOutcomes, state, steps);
          if (!a || a.action === 'finish') break;
          const beforeUrl = page.url();
          const note = await act(page, a);
          steps.push({
            action: a.action,
            detail: a.action === 'goto' ? (a.path ?? '') : `${a.role ?? ''} "${a.name ?? ''}"${a.value ? ` = ${a.value}` : ''}`,
            beforeUrl, afterUrl: page.url(), note,
          });
        }
      } catch (e) {
        if (e instanceof StopError) throw e;
        log(`  deep-behavior: "${feature.name}" exploration error (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await page.close().catch(() => {});
      }

      result.featuresExplored++;
      const meaningful = steps.filter(s => !s.note.startsWith('failed') && !s.note.startsWith('refused') && s.note !== 'no-op');
      if (meaningful.length === 0) { log(`  ○ "${feature.name}" — no exercisable behavior observed`); continue; }

      const spec = await emitSpec(model, feature.name, feature.expectedOutcomes, steps);
      if (!spec) { log(`  ○ "${feature.name}" — could not synthesize a grounded test`); continue; }
      const file = path.join(workspace.testsDir, `${slug(feature.name)}.behavior.spec.ts`);
      writeFileSync(file, spec, 'utf8');
      result.filesWritten.push(file);
      log(`  ✓ "${feature.name}" — wrote ${path.basename(file)} (${meaningful.length} observed step(s))`);
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const u = model.getUsage();
  log(`🧭 Deep-behavior done — ${result.filesWritten.length} behavior spec(s) from ${result.featuresExplored} feature(s) · ${((u.input + u.output) / 1000).toFixed(1)}k tokens`);
  return result;
}
