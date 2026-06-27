/**
 * Locator dry-run (Phase 2.6 runtime slice — OPT-IN, off by default).
 *
 * Static review can only check a locator against the CRAWL. It cannot catch the
 * most common first-run failure: a locator that looks valid against crawl data
 * but matches ZERO elements at runtime — e.g. getByRole('link',{name:'X'}) where
 * X's accessible name doesn't actually resolve by role on the live page (the
 * saucedemo product-title bug: 7 failing tests, all "matched no elements").
 *
 * This pass loads each spec's target page(s) in a real browser and checks every
 * simple locator resolves to ≥1 element. Zero-match locators are repaired ONLY
 * when it is unambiguous — exactly one live element has the intended text AND a
 * unique id — so it can never break a working locator. Everything else is just
 * flagged with a TODO. Uses NO LLM (token-free), reuses one browser, honors auth
 * state, and skips login-walled pages to avoid false positives.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import type { BrowserContext, Page } from 'playwright';
import { launchBrowser } from '@/lib/browser';
import type { Workspace } from './workspace';

const NAV_TIMEOUT = 20_000;

export interface LocatorCall {
  raw: string;                 // exact source substring, for replacement
  kind: 'role' | 'text' | 'label' | 'placeholder' | 'testid' | 'css';
  role?: string;
  name?: string;               // accessible name / text / label
  css?: string;
  line: number;                // 1-based
}

export interface DryRunResult {
  filesChecked: number;
  locatorsChecked: number;
  repaired: number;
  flagged: number;
}

// ── Pure extractors (unit-testable, no browser) ───────────────────────────────

/** Extract simple, top-level locator calls we can reconstruct via the API. */
export function extractLocatorCalls(code: string): LocatorCall[] {
  const out: LocatorCall[] = [];
  const lines = code.split('\n');
  const patterns: { re: RegExp; make: (m: RegExpExecArray) => LocatorCall | null }[] = [
    { re: /getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\s*\)/g,
      make: m => ({ raw: m[0], kind: 'role', role: m[1], name: m[2], line: 0 }) },
    { re: /getByText\(\s*['"]([^'"]+)['"]\s*\)/g,
      make: m => ({ raw: m[0], kind: 'text', name: m[1], line: 0 }) },
    { re: /getByLabel\(\s*['"]([^'"]+)['"]\s*\)/g,
      make: m => ({ raw: m[0], kind: 'label', name: m[1], line: 0 }) },
    { re: /getByPlaceholder\(\s*['"]([^'"]+)['"]\s*\)/g,
      make: m => ({ raw: m[0], kind: 'placeholder', name: m[1], line: 0 }) },
    { re: /getByTestId\(\s*['"]([^'"]+)['"]\s*\)/g,
      make: m => ({ raw: m[0], kind: 'testid', name: m[1], line: 0 }) },
    { re: /\blocator\(\s*'([^']+)'\s*\)/g,
      make: m => ({ raw: m[0], kind: 'css', css: m[1], line: 0 }) },
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const { re, make } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i])) !== null) {
        const call = make(m);
        if (call) { call.line = i + 1; out.push(call); }
      }
    }
  }
  return out;
}

/** Resolve goto() targets in the file to absolute URLs (best-effort). */
export function extractGotoTargets(code: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const origin = (() => { try { return new URL(baseUrl).origin; } catch { return baseUrl.replace(/\/$/, ''); } })();
  const re = /\.goto\(\s*([^)]+?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const arg = m[1];
    // Absolute literal
    const abs = arg.match(/['"`](https?:\/\/[^'"`]+)['"`]/);
    if (abs) { urls.add(abs[1]); continue; }
    // Any quoted path fragment → join to origin
    const frag = arg.match(/['"`](\/[^'"`]*)['"`]/) || arg.match(/['"`]([a-zA-Z0-9][^'"`:]*\.html[^'"`]*)['"`]/);
    if (frag) { urls.add(origin + (frag[1].startsWith('/') ? frag[1] : '/' + frag[1])); continue; }
    // Bare TARGET_URL / BASE_URL with no path
    if (/\b(TARGET_URL|BASE_URL|BASE)\b/.test(arg) && !arg.includes('+')) urls.add(baseUrl);
  }
  return Array.from(urls).slice(0, 3);
}

// ── Browser glue ──────────────────────────────────────────────────────────────

function buildLocator(page: Page, c: LocatorCall) {
  switch (c.kind) {
    case 'role':        return page.getByRole(c.role as Parameters<Page['getByRole']>[0], { name: c.name });
    case 'text':        return page.getByText(c.name!);
    case 'label':       return page.getByLabel(c.name!);
    case 'placeholder': return page.getByPlaceholder(c.name!);
    case 'testid':      return page.getByTestId(c.name!);
    case 'css':         return page.locator(c.css!);
  }
}

/** Looks like a login wall — skip so we don't false-flag auth-gated content. */
async function isLoginWall(page: Page): Promise<boolean> {
  if (/\b(login|signin|sign-in|auth)\b/i.test(page.url())) return true;
  return (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
}

/** Find a unique, stable replacement selector for an intended visible text. */
async function findStableSelector(page: Page, text: string): Promise<string | null> {
  return page.evaluate((name) => {
    const norm = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ');
    const matches = Array.from(document.querySelectorAll<HTMLElement>('a,button,[role],input,div,span,li'))
      .filter(el => norm(el.innerText) === name || el.getAttribute('aria-label') === name);
    if (matches.length !== 1) return null;          // ambiguous or absent → don't guess
    const el = matches[0];
    if (el.id) return `#${CSS.escape(el.id)}`;
    const dt = el.getAttribute('data-test') || el.getAttribute('data-testid');
    if (dt) {
      const attr = el.hasAttribute('data-test') ? 'data-test' : 'data-testid';
      if (document.querySelectorAll(`[${attr}="${dt}"]`).length === 1) return `[${attr}="${dt}"]`;
    }
    return null;
  }, text).catch(() => null);
}

export interface LocatorDryRunOptions {
  workspace: Workspace;
  baseUrl: string;
  authFile?: string | null;
  onProgress?: (line: string) => void;
  shouldStop?: () => boolean;
}

export async function runLocatorDryRun(opts: LocatorDryRunOptions): Promise<DryRunResult> {
  const { workspace, baseUrl, authFile, onProgress, shouldStop } = opts;
  const log = (m: string) => onProgress?.(m);
  const result: DryRunResult = { filesChecked: 0, locatorsChecked: 0, repaired: 0, flagged: 0 };

  const testsDir = workspace.testsDir;
  if (!existsSync(testsDir)) return result;
  const specs = readdirSync(testsDir).filter(f => f.endsWith('.spec.ts')).map(f => path.join(testsDir, f));
  if (specs.length === 0) return result;

  const browser = await launchBrowser();
  let ctx: BrowserContext | null = null;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...(authFile && existsSync(authFile) ? { storageState: authFile } : {}),
    });
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);

    for (const specPath of specs) {
      if (shouldStop?.()) break;
      let code = readFileSync(specPath, 'utf8');
      const calls = extractLocatorCalls(code);
      const targets = extractGotoTargets(code, baseUrl);
      if (calls.length === 0 || targets.length === 0) continue;
      result.filesChecked++;
      const fileName = path.basename(specPath);

      // Load this file's pages once; a locator is "live" if it resolves on any.
      const pages: Page[] = [];
      for (const url of targets) {
        if (shouldStop?.()) break;
        const p = await ctx.newPage();
        try {
          await p.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
          await p.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
          if (await isLoginWall(p)) { await p.close().catch(() => {}); continue; }
          pages.push(p);
        } catch { await p.close().catch(() => {}); }
      }
      if (pages.length === 0) { log(`  ⏭ ${fileName} — pages unreachable/auth-walled, skipped`); continue; }

      // Dedupe locator subjects so we check each unique one once.
      const seen = new Set<string>();
      let changed = false;
      for (const c of calls) {
        if (seen.has(c.raw)) continue;
        seen.add(c.raw);
        result.locatorsChecked++;
        // Max matches on any SINGLE page (strict mode is per-page; summing across
        // pages would mis-read 1-per-page as a strict-mode multi-match).
        let maxCount = 0;
        for (const p of pages) {
          const cnt = await buildLocator(p, c)!.count().catch(() => 0);
          if (cnt > maxCount) maxCount = cnt;
        }
        if (maxCount === 1) continue; // unique → fine

        // Strict-mode risk: the locator matches MULTIPLE elements on a page (e.g.
        // saucedemo renders an image-link + title-link with the same accessible
        // name). Playwright throws on .click()/.toBeVisible() — pin to .first().
        if (maxCount > 1) {
          if (!code.includes(c.raw + '.first(') && !code.includes(c.raw + '.nth(')) {
            code = code.split(c.raw).join(c.raw + '.first()');
            changed = true;
            result.repaired++;
            log(`  🔧 ${fileName}:${c.line} — ${c.kind} "${c.name ?? c.css}" matched ${maxCount} live (strict mode) → pinned .first()`);
          }
          continue;
        }

        // maxCount === 0 — zero matches. Try a high-confidence repair for role/text locators.
        let replacement: string | null = null;
        if ((c.kind === 'role' || c.kind === 'text') && c.name) {
          for (const p of pages) {
            replacement = await findStableSelector(p, c.name);
            if (replacement) break;
          }
        }
        if (replacement) {
          code = code.split(c.raw).join(`locator('${replacement}')`);
          changed = true;
          result.repaired++;
          log(`  🔧 ${fileName}:${c.line} — ${c.kind} "${c.name ?? c.css}" matched 0 live → locator('${replacement}')`);
        } else {
          code = code.replace(c.raw, `${c.raw} /* ⚠ TODO: matched 0 elements at runtime — verify selector */`);
          changed = true;
          result.flagged++;
          log(`  ⚠ ${fileName}:${c.line} — ${c.kind} "${c.name ?? c.css}" matched 0 live (flagged, no safe fix)`);
        }
      }

      for (const p of pages) await p.close().catch(() => {});
      if (changed) writeFileSync(specPath, code, 'utf8');
    }

    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  if (result.repaired > 0 || result.flagged > 0) {
    log(`🔬 Locator dry-run — ${result.locatorsChecked} checked · ${result.repaired} repaired · ${result.flagged} flagged across ${result.filesChecked} file(s).`);
  } else if (result.filesChecked > 0) {
    log(`🔬 Locator dry-run — all ${result.locatorsChecked} locator(s) resolve live across ${result.filesChecked} file(s).`);
  }
  return result;
}
