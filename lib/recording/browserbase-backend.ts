/**
 * BrowserbaseBackend — RecordingBackend on the managed Browserbase service.
 *
 * No self-hosted infra: each recording creates a Browserbase session (a hosted
 * Chrome), we attach over CDP (`connectUrl`) to inject the recorder + collect the
 * trace, and embed Browserbase's interactive **Live View** (`debuggerFullscreenUrl`)
 * as the smooth, clickable view. Recorder + codegen are identical to every
 * other backend.
 *
 * Env:
 *   BROWSERBASE_API_KEY      required
 *   BROWSERBASE_PROJECT_ID   required (Browserbase project to bill/scope the session)
 */
import { randomUUID } from 'crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { buildRecorderScript, drainActions } from './recorder-script';
import type {
  RecordingBackend, RecordingHandle, StartRecordingOptions, RecordedAction,
} from './types';

const API = 'https://api.browserbase.com';

interface LiveSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  actions: RecordedAction[];
  timer: ReturnType<typeof setInterval>;
  bbSessionId: string;
  targetUrl: string;
}

const live = new Map<string, LiveSession>();

/** Pull buffered actions out of every open page (covers new tabs/popups). */
async function drainAll(browser: Browser): Promise<RecordedAction[]> {
  const out: RecordedAction[] = [];
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) out.push(...await drainActions(p));
  }
  return out;
}

export class BrowserbaseBackend implements RecordingBackend {
  constructor(
    private apiKey = process.env.BROWSERBASE_API_KEY ?? '',
    private projectId = process.env.BROWSERBASE_PROJECT_ID ?? '',
  ) {}

  private headers() {
    return { 'X-BB-API-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  async start(opts: StartRecordingOptions): Promise<RecordingHandle> {
    if (!this.apiKey || !this.projectId) {
      throw new Error('BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not configured');
    }

    // 1) Create a hosted session → get the CDP connect URL.
    const createRes = await fetch(`${API}/v1/sessions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ projectId: this.projectId }),
    });
    if (!createRes.ok) throw new Error(`Browserbase create session failed: ${createRes.status} ${await createRes.text().catch(() => '')}`);
    const session = await createRes.json() as { id: string; connectUrl: string };
    if (!session.connectUrl) throw new Error('Browserbase session has no connectUrl');

    // 2) Fetch the embeddable interactive Live View URL.
    let viewUrl = '';
    try {
      const dbg = await fetch(`${API}/v1/sessions/${session.id}/debug`, { headers: this.headers() });
      if (dbg.ok) {
        const d = await dbg.json() as { debuggerFullscreenUrl?: string; debuggerUrl?: string };
        viewUrl = d.debuggerFullscreenUrl || d.debuggerUrl || '';
      }
    } catch { /* view is best-effort; recording still works without it */ }

    // 3) Attach over CDP to inject the recorder (buffers to sessionStorage).
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const recordingId = randomUUID();
    const actions: RecordedAction[] = [];
    const script = buildRecorderScript();

    // Arm the recorder on every context + existing pages + any new tab/popup.
    const arm = async (ctx: BrowserContext) => {
      await ctx.addInitScript(script).catch(() => {});               // future documents
      for (const p of ctx.pages()) await p.evaluate(script).catch(() => {}); // current docs
      ctx.on('page', (p) => { void p.evaluate(script).catch(() => {}); });
    };
    const contexts = browser.contexts().length ? browser.contexts() : [await browser.newContext()];
    for (const c of contexts) await arm(c);

    const context = contexts[0];
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.evaluate(script).catch(() => {});

    // Poll buffered actions out of the page(s) — reliable over connectOverCDP.
    const timer = setInterval(() => {
      void drainAll(browser).then(d => { if (d.length) actions.push(...d); }).catch(() => {});
    }, 500);

    live.set(recordingId, { browser, context, page, actions, timer, bbSessionId: session.id, targetUrl: opts.url });
    return { recordingId, viewUrl }; // iframe = Browserbase Live View (smooth, interactive)
  }

  async getTrace(recordingId: string): Promise<RecordedAction[]> {
    const s = live.get(recordingId);
    if (!s) return [];
    const d = await drainAll(s.browser).catch(() => []); // fresh pull for the live list
    if (d.length) s.actions.push(...d);
    return s.actions.slice();
  }

  async setAssertMode(recordingId: string, on: boolean): Promise<void> {
    const s = live.get(recordingId);
    if (!s) return;
    await s.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: boolean) => (window as any).__tpSetAssertMode?.(v),
      on,
    ).catch(() => {});
  }

  async stop(recordingId: string): Promise<RecordedAction[]> {
    const s = live.get(recordingId);
    if (!s) return [];
    clearInterval(s.timer);
    const tail = await drainAll(s.browser).catch(() => []); // final pull before closing
    if (tail.length) s.actions.push(...tail);
    const actions = s.actions.slice();
    await s.browser.close().catch(() => {});
    // Release the hosted session so it stops billing.
    await fetch(`${API}/v1/sessions/${s.bbSessionId}`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ projectId: this.projectId, status: 'REQUEST_RELEASE' }),
    }).catch(() => {});
    live.delete(recordingId);
    return actions;
  }

  isLive(recordingId: string): boolean {
    return live.has(recordingId);
  }
}
