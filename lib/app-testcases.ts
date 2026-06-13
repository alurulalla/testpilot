/**
 * App test cases — the union of tests TestPilot has identified / generated /
 * added across every session for one app (org + hostname).
 *
 * Source of truth is the durable SessionFile table (the stored suite), not the
 * ephemeral disk workspace, so this works across redeploys. We extract each
 * spec's test() titles and aggregate by test, counting how many sessions
 * contain it — that "coverage" is the consistency signal: a test present in
 * every session means we generate it reliably from this URL.
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { ChatModel } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Extract each test's { title, body } from spec source. */
function extractTests(content: string): { title: string; body: string }[] {
  const re = /(?:test|it)(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const out: { title: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({ title: m[2], body: bodyAfter(content, re.lastIndex) });
  }
  return out;
}

/** Grab the arrow-function body `{ … }` that follows the test title. */
function bodyAfter(s: string, from: number): string {
  const brace = s.indexOf('{', s.indexOf('=>', from));
  if (brace < 0) return '';
  let depth = 0, mode: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = brace; i < s.length; i++) {
    const c = s[i];
    if (mode === 'sq') { if (c === '\\') i++; else if (c === "'") mode = 'code'; continue; }
    if (mode === 'dq') { if (c === '\\') i++; else if (c === '"') mode = 'code'; continue; }
    if (mode === 'tpl') { if (c === '\\') i++; else if (c === '`') mode = 'code'; continue; }
    if (c === "'") mode = 'sq';
    else if (c === '"') mode = 'dq';
    else if (c === '`') mode = 'tpl';
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(brace + 1, i); }
  }
  return s.slice(brace + 1);
}

/** Short, human label for a Playwright locator referenced in a line. */
function locatorLabel(line: string): string {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/getByRole\(\s*['"`](\w+)['"`][\s\S]*?name:\s*['"`]([^'"`]+)['"`]/))) return `${m[1]} "${m[2]}"`;
  if ((m = line.match(/getByRole\(\s*['"`](\w+)['"`]/))) return m[1];
  if ((m = line.match(/getByText\(\s*['"`]([^'"`]+)['"`]/))) return `text "${m[1]}"`;
  if ((m = line.match(/getByLabel\(\s*['"`]([^'"`]+)['"`]/))) return `"${m[1]}" field`;
  if ((m = line.match(/getByPlaceholder\(\s*['"`]([^'"`]+)['"`]/))) return `"${m[1]}" field`;
  if ((m = line.match(/getByTestId\(\s*['"`]([^'"`]+)['"`]/))) return `[${m[1]}]`;
  // Capture the full selector even when it contains inner quotes, e.g. a[href="…"].
  if ((m = line.match(/locator\(\s*(['"`])((?:\\.|(?!\1).)*)\1/))) {
    const sel = m[2];
    return sel.length > 40 ? sel.slice(0, 39) + '…' : sel;
  }
  if (/\bpage\b/.test(line)) return 'page';
  return 'element';
}

const MATCHER: Record<string, string> = {
  toBeVisible: 'is visible', toBeHidden: 'is hidden', toBeEnabled: 'is enabled',
  toBeDisabled: 'is disabled', toBeChecked: 'is checked', toBeAttached: 'exists',
  toHaveText: 'has text', toContainText: 'contains text', toHaveValue: 'has value',
  toHaveURL: 'URL matches', toHaveTitle: 'title matches', toHaveCount: 'count matches',
  toHaveAttribute: 'has attribute', toHaveClass: 'has class', toBeFocused: 'is focused',
};

function cleanUrl(arg: string): string {
  const m = arg.match(/['"`]([^'"`]+)['"`]/);
  let u = m ? m[1] : arg.replace(/.*\+\s*/, '').trim();
  try { u = new URL(u).pathname; } catch { /* relative — keep as-is */ }
  return u || '/';
}

/** Build a concise "what it does" flow from a test body. No LLM. */
function describeTest(body: string, title: string): string {
  const steps: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let m: RegExpMatchArray | null;
    if (/\blogin\s*\(/.test(line)) steps.push('log in');
    else if ((m = line.match(/\.goto\(\s*([^;]+?)\)/))) steps.push(`go to ${cleanUrl(m[1])}`);
    else if (/expect\(/.test(line)) {
      const matcher = (line.match(/\.(to[A-Za-z]+)\s*\(/) || [])[1];
      steps.push(`expect ${locatorLabel(line)} ${MATCHER[matcher] ?? matcher ?? 'matches'}`.trim());
    }
    else if (/\.click\(/.test(line)) steps.push(`click ${locatorLabel(line)}`);
    else if (/\.fill\(/.test(line)) steps.push(`fill ${locatorLabel(line)}`);
    else if (/\.selectOption\(/.test(line)) steps.push(`select ${locatorLabel(line)}`);
    else if (/\.check\(/.test(line)) steps.push(`check ${locatorLabel(line)}`);
    else if (/\.press\(/.test(line)) steps.push('press a key');
    else if (/\.hover\(/.test(line)) steps.push(`hover ${locatorLabel(line)}`);
  }
  // Collapse consecutive duplicates and cap length.
  const flow: string[] = [];
  for (const s of steps) if (s !== flow[flow.length - 1]) flow.push(s);
  if (flow.length === 0) return title;
  const shown = flow.slice(0, 6).join(' -> ');
  return flow.length > 6 ? `${shown} -> ...` : shown;
}

export type TestCaseSource = 'generated' | 'scenario' | 'figma';

export interface AppTestCase {
  title: string;
  description: string;       // user-facing use case (AI), falls back to title
  area: string;              // functional area (AI), e.g. "Cart", "Checkout"
  file: string;              // spec basename
  source: TestCaseSource;
  sessionCount: number;      // how many sessions contain this test
  coverage: number;          // 0-100 (sessionCount / sessions-with-a-suite)
}

export interface AppTestCases {
  host: string;
  totalSessions: number;     // all sessions for this app
  suiteSessions: number;     // sessions that actually have a generated suite
  uniqueCount: number;
  avgPerSession: number;
  consistentCount: number;   // tests present in EVERY suite session
  cases: AppTestCase[];
}

// ── AI use-case descriptions (persisted, generate-once) ──────────────────────
// One plain-language sentence per test ("User can add a product to the cart").
// Keyed by a content hash and stored in Postgres, so each unique test is sent
// to the LLM ONCE ever — reused across sessions, redeploys, and instances.
// The deterministic flow (describeTest) is passed only as grounding context.

interface UseCaseItem { hash: string; title: string; flow: string }

/**
 * Normalized SEMANTIC signature of a test, from its action flow rather than its
 * title. The flow comes from the code/selectors, which barely change even when
 * the LLM rewords the title ("Twitter footer link is visible" vs "Twitter
 * social link is present in footer"). Keying on this collapses re-phrasings
 * into one test, so coverage/consistency reflect real behaviour, not prose
 * churn. Falls back to the title when no flow is detected.
 */
function flowSig(flow: string, title: string): string {
  const base = flow && flow !== title ? flow : title;
  return base.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Stable per-test key for the description store: host + file + signature. */
function sigHash(host: string, file: string, sig: string): string {
  return createHash('sha256').update(`${host} ${file} ${sig}`).digest('hex');
}

/**
 * Instant, deterministic functional area from the test's file + title keywords.
 * Used as the default so the Areas view is meaningful immediately — no LLM, no
 * async backfill, works on any build. The AI-generated area (when stored) takes
 * precedence and refines it.
 */
function deterministicArea(file: string, title: string): string {
  const s = `${file} ${title}`.toLowerCase();
  const has = (...kw: string[]) => kw.some(k => s.includes(k));
  if (has('login', 'log in', 'sign in', 'logout', 'sign out', 'password', 'locked', 'lock out', 'credential', 'authenticat')) return 'Authentication';
  if (has('checkout', 'payment', 'billing', 'shipping', 'order summary', 'overview', 'confirmation', 'finish', 'complete order', 'place order')) return 'Checkout';
  if (has('cart', 'add to cart', 'remove from cart', 'basket', 'badge')) return 'Cart';
  if (has('sort', 'order by', 'filter')) return 'Sorting & Filtering';
  if (has('footer', 'twitter', 'facebook', 'linkedin', 'social', 'copyright')) return 'Footer';
  if (has('menu', 'burger', 'hamburger', 'navigation', 'navigate', 'back to products', 'sidebar', 'breadcrumb')) return 'Navigation';
  if (has('search')) return 'Search';
  if (has('detail', 'product page')) return 'Product Detail';
  if (has('product', 'inventory', 'item', 'price', 'description', 'image', 'catalog', 'listing')) return 'Product Catalog';
  if (has('title', 'loads', 'homepage', 'home page', 'header', 'landing')) return 'Page Load';
  return 'General';
}

interface StoredDesc { useCase: string; area: string | null }

/** Load already-stored descriptions (useCase + area) for these hashes. */
async function loadStored(orgId: string, hashes: string[]): Promise<Record<string, StoredDesc>> {
  const byHash: Record<string, StoredDesc> = {};
  if (hashes.length === 0) return byHash;
  const rows = await prisma.testCaseDescription
    .findMany({ where: { orgId, hash: { in: hashes } }, select: { hash: true, useCase: true, area: true } })
    .catch(() => [] as { hash: string; useCase: string; area: string | null }[]);
  for (const r of rows) byHash[r.hash] = { useCase: r.useCase, area: r.area };
  return byHash;
}

// Apps currently being backfilled (per process) — avoids duplicate concurrent
// generation when several viewers open the same app's tab at once.
const backfilling = new Set<string>();

/**
 * Generate the MISSING descriptions in the background and persist them PER
 * BATCH. Never awaited by the request, so the tab loads instantly; descriptions
 * appear on a later view. Per-batch persistence means progress always sticks
 * even if the process is interrupted, so it can never get stuck regenerating.
 */
function backfillUseCases(orgId: string, host: string, misses: UseCaseItem[]): void {
  const key = `${orgId}|${host}`;
  if (misses.length === 0 || backfilling.has(key)) return;
  backfilling.add(key);

  void (async () => {
    try {
      let model: ChatModel;
      try {
        model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(orgId)));
      } catch {
        return; // no model/key configured — descriptions stay as title fallbacks
      }

      const BATCH = 40;
      for (let start = 0; start < misses.length; start += BATCH) {
        const batch = misses.slice(start, start + BATCH);
        const list = batch
          .map((it, i) => `${i}. ${it.title}${it.flow ? `  (steps: ${it.flow})` : ''}`)
          .join('\n');
        const prompt =
          `App under test: ${host}\n\n` +
          `For each test below, provide:\n` +
          `  - "useCase": ONE short sentence describing what it verifies, from the end user's ` +
          `perspective (e.g. "User can add a product to the cart from the inventory page"). ` +
          `Avoid CSS selectors, code, and the word "test".\n` +
          `  - "area": the functional area in 1-2 words (e.g. Authentication, Cart, Checkout, ` +
          `Product Catalog, Navigation, Footer, Search, Account). Reuse the SAME label for ` +
          `related tests so areas stay consistent.\n\n` +
          `Tests:\n${list}\n\n` +
          `Return ONLY JSON: {"items":[{"id":0,"useCase":"...","area":"..."}]}`;
        try {
          const raw = await model.invoke(
            [
              { role: 'system', content: 'You write concise, end-user-facing use-case descriptions and tag a functional area. Respond with valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            { maxTokens: 2_048 },
          );
          const parsed = JSON.parse(raw.replace(/```(?:json)?\n?/g, '').trim()) as { items?: { id: number; useCase: string; area?: string }[] };
          const rows = (parsed.items ?? [])
            .map(r => ({ it: batch[r.id], useCase: r.useCase, area: r.area }))
            .filter(x => x.it && x.useCase)
            .map(x => ({ hash: x.it!.hash, title: x.it!.title, useCase: x.useCase.trim().slice(0, 200), area: x.area?.trim().slice(0, 40) || null }));
          // Upsert so rows missing an area (created before the area field) get
          // updated, not skipped.
          await Promise.all(rows.map(r =>
            prisma.testCaseDescription.upsert({
              where: { orgId_hash: { orgId, hash: r.hash } },
              create: { orgId, host, hash: r.hash, title: r.title, useCase: r.useCase, area: r.area, model: model.modelName },
              update: { useCase: r.useCase, area: r.area, model: model.modelName },
            }).catch(() => {}),
          ));
        } catch { /* skip this batch; a later view will retry the misses */ }
      }
    } finally {
      backfilling.delete(key);
    }
  })();
}

export async function getAppTestCases(orgId: string, host: string): Promise<AppTestCases> {
  const empty: AppTestCases = {
    host, totalSessions: 0, suiteSessions: 0, uniqueCount: 0,
    avgPerSession: 0, consistentCount: 0, cases: [],
  };

  const sessions = await prisma.session.findMany({ where: { orgId }, select: { id: true, url: true } });
  const ids = sessions.filter(s => hostOf(s.url) === host).map(s => s.id);
  if (ids.length === 0) return empty;

  const files = await prisma.sessionFile.findMany({
    where: { sessionId: { in: ids }, deletedAt: null, kind: { in: ['generated', 'scenario', 'figma'] } },
    select: { sessionId: true, path: true, content: true, kind: true },
  });

  const map = new Map<string, { hash: string; title: string; flow: string; file: string; kinds: Set<string>; sessions: Set<string> }>();
  const suiteSessions = new Set<string>();
  let totalTitles = 0;

  for (const f of files) {
    if (!f.path.endsWith('.spec.ts')) continue;
    const base = f.path.split('/').pop() ?? f.path;
    const tests = extractTests(f.content);
    if (tests.length) suiteSessions.add(f.sessionId);
    for (const t of tests) {
      totalTitles++;
      const flow = describeTest(t.body, t.title);
      const sig = flowSig(flow, t.title);
      const key = `${base} :: ${sig}`; // semantic key — merges re-phrasings
      const e = map.get(key) ?? { hash: sigHash(host, base, sig), title: t.title, flow, file: base, kinds: new Set<string>(), sessions: new Set<string>() };
      if (t.title.length < e.title.length) e.title = t.title; // prefer the cleanest title
      if (flow.length > e.flow.length) e.flow = flow;
      e.kinds.add(f.kind);
      e.sessions.add(f.sessionId);
      map.set(key, e);
    }
  }

  // User-facing use case per test. Read what's already stored (fast DB read);
  // generate any missing ones in the BACKGROUND so the tab loads instantly and
  // never blocks on the LLM. Missing descriptions fall back to the title for now
  // and appear on a later view once the background backfill has persisted them.
  const entries = [...map.values()];
  const stored = await loadStored(orgId, entries.map(e => e.hash));
  // A test needs (re)generation if it has no stored row OR the row predates the
  // functional-area field (useCase present but area missing).
  const misses = entries
    .filter(e => { const s = stored[e.hash]; return !s || !s.area; })
    .map(e => ({ hash: e.hash, title: e.title, flow: e.flow }));
  if (misses.length > 0) backfillUseCases(orgId, host, misses); // fire-and-forget

  const denom = suiteSessions.size || 1;
  const cases: AppTestCase[] = entries
    .map(e => ({
      title: e.title,
      description: stored[e.hash]?.useCase ?? e.title, // title fallback until backfill lands
      area: stored[e.hash]?.area || deterministicArea(e.file, e.title), // instant default; AI refines
      file: e.file,
      source: (e.kinds.has('scenario') ? 'scenario' : e.kinds.has('figma') ? 'figma' : 'generated') as TestCaseSource,
      sessionCount: e.sessions.size,
      coverage: Math.round((e.sessions.size / denom) * 100),
    }))
    .sort((a, b) =>
      b.sessionCount - a.sessionCount ||
      a.file.localeCompare(b.file) ||
      a.title.localeCompare(b.title),
    );

  return {
    host,
    totalSessions: ids.length,
    suiteSessions: suiteSessions.size,
    uniqueCount: cases.length,
    avgPerSession: suiteSessions.size ? Math.round(totalTitles / suiteSessions.size) : 0,
    consistentCount: suiteSessions.size ? cases.filter(c => c.sessionCount === suiteSessions.size).length : 0,
    cases,
  };
}
