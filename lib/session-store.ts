/**
 * session-store.ts — Prisma-backed session persistence
 *
 * Sessions are written to PostgreSQL on every state change (fire-and-forget).
 * The in-memory Map acts as an L1 cache so pipeline callbacks (addLog, setStatus…)
 * stay synchronous — they update memory immediately and queue a DB write.
 *
 * On a cold start (server restart), getSession() falls back to a DB load so
 * sessions survive deployments and process restarts.
 *
 * Transient runtime state (SSE subscribers, stopping flags, child processes) is
 * intentionally NOT persisted — these are process-local concerns.
 */

import { prisma } from '@/lib/prisma';
import type { ChildProcess } from 'child_process';
import {
  Session, LogEntry, SessionStatus, SiteMap,
  TestResult, FixResult, FigmaResult, ScenarioResult,
  UserFlow, TriageResult, ImportedProject, CoverageAnalysis,
} from '@/types/session';

// ── Transient runtime state ───────────────────────────────────────────────────
// Pinned to globalThis so Turbopack's multiple module instances share one Map.

declare global {
  // eslint-disable-next-line no-var
  var __tp_sessions: Map<string, Session> | undefined;
  // eslint-disable-next-line no-var
  var __tp_subscribers: Map<string, Set<ReadableStreamDefaultController>> | undefined;
  // eslint-disable-next-line no-var
  var __tp_stopping: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __tp_processes: Map<string, ChildProcess> | undefined;
  // eslint-disable-next-line no-var
  var __tp_logbuf: Map<string, { message: string; level: string; createdAt: Date }[]> | undefined;
  // eslint-disable-next-line no-var
  var __tp_logtimer: ReturnType<typeof setTimeout> | undefined;
  // eslint-disable-next-line no-var
  var __tp_chunkseq: Map<string, number> | undefined;
}

const sessions: Map<string, Session>    = (globalThis.__tp_sessions    ??= new Map());
const subscribers: Map<string, Set<ReadableStreamDefaultController>> =
                                          (globalThis.__tp_subscribers ??= new Map());
const stopping: Set<string>             = (globalThis.__tp_stopping    ??= new Set());
const runningProcesses: Map<string, ChildProcess> =
                                          (globalThis.__tp_processes   ??= new Map());
const logBuffer: Map<string, { message: string; level: string; createdAt: Date }[]> =
                                          (globalThis.__tp_logbuf      ??= new Map());

// ── DB ↔ Session conversion ───────────────────────────────────────────────────

type DbRow = Awaited<ReturnType<typeof prisma.session.findUniqueOrThrow>>;

function dbToSession(row: DbRow, logs: LogEntry[] = []): Session {
  return {
    id:              row.id,
    orgId:           row.orgId,
    createdByUserId: row.createdByUserId,
    url:             row.url,
    status:          row.status as SessionStatus,
    figmaFileUrl:    row.figmaFileUrl  ?? null,
    figmaFrameMap:   (row.figmaFrameMap ?? null) as Record<string, string> | null,
    figmaOnly:       row.figmaOnly,
    figmaChecking:   row.figmaChecking,
    iteration:       row.iteration,
    error:           row.error         ?? null,
    maxPages:        row.maxPages,
    headedMode:      row.headedMode,
    contextDoc:      row.contextDoc     ?? null,
    contextDocName:  row.contextDocName ?? null,
    siteMap:         (row.siteMap          ?? null) as SiteMap           | null,
    figmaResult:     (row.figmaResult      ?? null) as FigmaResult       | null,
    testFiles:       ((row.testFiles       as string[] | null) ?? []),
    testResult:      (row.testResult       ?? null) as TestResult        | null,
    fixResult:       (row.fixResult        ?? null) as FixResult         | null,
    triageResult:    (row.triageResult     ?? null) as TriageResult      | null,
    scenarioResult:  (row.scenarioResult   ?? null) as ScenarioResult    | null,
    importedProject: (row.importedProject  ?? null) as ImportedProject   | null,
    coverageAnalysis:(row.coverageAnalysis ?? null) as CoverageAnalysis  | null,
    userFlows:       ((row.userFlows       as UserFlow[] | null) ?? []),
    logs,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

// ── Write helpers ─────────────────────────────────────────────────────────────

const JSON_FIELDS = [
  'siteMap', 'figmaResult', 'testFiles', 'testResult', 'fixResult',
  'triageResult', 'scenarioResult', 'importedProject', 'coverageAnalysis',
  'userFlows', 'figmaFrameMap',
] as const;

const SCALAR_FIELDS = [
  'status', 'figmaChecking', 'figmaFileUrl', 'figmaOnly',
  'contextDoc', 'contextDocName', 'iteration', 'error', 'maxPages', 'headedMode',
] as const;

function patchToData(patch: Partial<Session>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of SCALAR_FIELDS) {
    if (f in patch) data[f] = (patch as Record<string, unknown>)[f] ?? null;
  }
  for (const f of JSON_FIELDS) {
    if (f in patch) data[f] = (patch as Record<string, unknown>)[f] ?? null;
  }
  return data;
}

function dbWrite(id: string, data: Record<string, unknown>): void {
  if (Object.keys(data).length === 0) return;
  prisma.session.update({ where: { id }, data }).catch(() => {});
}

// ── Stopping / process helpers (runtime-only) ─────────────────────────────────

export function markStopping(id: string): void  { stopping.add(id); }
export function clearStopping(id: string): void  { stopping.delete(id); }
export function isStopping(id: string): boolean  { return stopping.has(id); }

export function registerProcess(id: string, proc: ChildProcess): void { runningProcesses.set(id, proc); }
export function unregisterProcess(id: string): void                    { runningProcesses.delete(id); }
export function killProcess(id: string): void {
  const proc = runningProcesses.get(id);
  if (proc) { try { proc.kill('SIGTERM'); } catch { /* already dead */ } }
  runningProcesses.delete(id);
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a new session scoped to an organisation.
 * @param orgId           - The organisation's DB id
 * @param createdByUserId - Clerk user id of the member who started the session
 */
export async function createSession(
  url: string,
  maxPages = 10,
  headedMode = false,
  figmaFileUrl: string | null = null,
  figmaOnly = false,
  orgId: string,
  createdByUserId: string,
  figmaFrameMap: Record<string, string> | null = null,
): Promise<Session> {
  const row = await prisma.session.create({
    data: {
      orgId,
      createdByUserId,
      url,
      maxPages,
      headedMode,
      figmaFileUrl: figmaFileUrl ?? undefined,
      figmaFrameMap: figmaFrameMap ?? undefined,
      figmaOnly,
      userFlows: [],
    },
  });
  const session = dbToSession(row);
  sessions.set(row.id, session);
  return session;
}

/**
 * Permanently delete a session and its DB-cascaded children (logs, files).
 * Also clears all in-memory/runtime state for it. Caller is responsible for
 * disk-workspace cleanup and for ensuring the session isn't actively running.
 */
function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export async function deleteSession(id: string): Promise<void> {
  // Capture org + url before removal so we can clean up app-scoped derived data.
  const meta = sessions.get(id)
    ?? await prisma.session.findUnique({ where: { id }, select: { orgId: true, url: true } }).catch(() => null);

  sessions.delete(id);
  subscribers.delete(id);
  stopping.delete(id);
  runningProcesses.delete(id);
  logBuffer.delete(id);
  chunkSeq.delete(id);
  try {
    await prisma.session.delete({ where: { id } });
  } catch {
    // Already gone or never persisted — fine.
  }

  // TestCaseDescription rows are keyed by org+host (not FK'd to Session), so
  // they don't cascade-delete. When the LAST session for an app is removed,
  // purge them — otherwise deleting an app leaves stale data that resurfaces
  // if the same URL is added again.
  if (meta) {
    try {
      const host = hostOfUrl(meta.url);
      const remaining = await prisma.session.findMany({ where: { orgId: meta.orgId }, select: { url: true } });
      const stillHasApp = remaining.some(s => hostOfUrl(s.url) === host);
      if (!stillHasApp) {
        await prisma.testCaseDescription.deleteMany({ where: { orgId: meta.orgId, host } });
      }
    } catch {
      // Best-effort cleanup — never block deletion on it.
    }
  }
}

/**
 * Load a session — L1 cache first, then DB.
 * Populates the cache so subsequent synchronous getCachedSession() calls work.
 */
export async function getSession(id: string): Promise<Session | undefined> {
  const cached = sessions.get(id);
  if (cached) return cached;
  // Cache miss (e.g. after server restart) — load from DB
  const row = await prisma.session.findUnique({ where: { id } });
  if (!row) return undefined;

  // Logs live in chunks — flatten them back into the in-memory LogEntry list.
  let logs: LogEntry[] = [];
  try {
    const chunks = await prisma.sessionLogChunk.findMany({
      where: { sessionId: id },
      orderBy: { seq: 'asc' },
    });
    logs = chunks.flatMap(c => (c.content as unknown as LogEntry[]) ?? []);
  } catch { /* logs are non-critical — session still loads */ }

  const session = dbToSession(row, logs);
  normalizeInterrupted(session);
  sessions.set(id, session);
  return session;
}

// ── Stale-run recovery ────────────────────────────────────────────────────────
// Pipelines run inside this process; they do not survive a restart/redeploy.
// So if a session loads from the DB with an "active" status while absent from
// the in-memory cache, the run it claims is provably dead — normalise it to
// failed so re-runs and deletion work instead of being blocked forever.

const RUNNING_STATUSES: SessionStatus[] = [
  'exploring', 'analyzing', 'generating', 'running', 'fixing', 'figma-checking',
];

function normalizeInterrupted(session: Session): void {
  const wasRunning = RUNNING_STATUSES.includes(session.status);
  if (!wasRunning && !session.figmaChecking) return;

  if (wasRunning) {
    session.status = 'failed';
    session.error = session.error
      ?? 'Run interrupted — the server restarted while this session was running. Start a new run.';
  }
  session.figmaChecking = false;

  // Persist the correction (fire-and-forget; safe to repeat).
  prisma.session.update({
    where: { id: session.id },
    data: { status: session.status, error: session.error, figmaChecking: false },
  }).catch(() => {});
}

/**
 * Synchronous cache-only lookup.
 * Safe to call after an async getSession() has already populated the cache,
 * or inside SSE callbacks / async IIFEs where await is impractical.
 */
export function getCachedSession(id: string): Session | undefined {
  return sessions.get(id);
}

/** List all sessions for an organisation, newest first.
 *
 * Logs are intentionally excluded — the list view only needs session metadata.
 * Individual session pages call getSession(id) which loads full logs from DB
 * and warms the cache correctly.  Caching here would store log-less sessions
 * and cause getSession() cache hits to incorrectly return empty log arrays.
 */
export async function listSessions(orgId: string): Promise<Session[]> {
  // NARROW select — list views must not drag the heavy JSON blobs (siteMap,
  // figmaResult, contextDoc, …) for every session on every dashboard load.
  // pagesCount stands in for siteMap.total_pages via a synthesised stub.
  const rows = await prisma.session.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, orgId: true, createdByUserId: true, url: true,
      status: true, figmaChecking: true, figmaFileUrl: true,
      iteration: true, error: true, maxPages: true, headedMode: true,
      figmaOnly: true, pagesCount: true,
      testFiles: true, testResult: true,
      createdAt: true, updatedAt: true,
    },
  });
  return rows.map(r => {
    const session: Session = {
      id:              r.id,
      orgId:           r.orgId,
      createdByUserId: r.createdByUserId,
      url:             r.url,
      status:          r.status as SessionStatus,
      figmaFileUrl:    r.figmaFileUrl ?? null,
      figmaFrameMap:   null,
      figmaOnly:       r.figmaOnly,
      figmaChecking:   r.figmaChecking,
      iteration:       r.iteration,
      error:           r.error ?? null,
      maxPages:        r.maxPages,
      headedMode:      r.headedMode,
      contextDoc:      null,
      contextDocName:  null,
      // Stub carrying only the count — list UIs read siteMap?.total_pages.
      siteMap: r.pagesCount > 0
        ? { start_url: r.url, total_pages: r.pagesCount, pages: [] }
        : null,
      figmaResult:     null,
      testFiles:       ((r.testFiles as string[] | null) ?? []),
      testResult:      (r.testResult ?? null) as TestResult | null,
      fixResult:       null,
      triageResult:    null,
      scenarioResult:  null,
      importedProject: null,
      coverageAnalysis: null,
      userFlows:       [],
      logs:            [],
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    };
    // A session showing an active status that is NOT in this process's cache
    // has no live run behind it (runs never survive restarts) — normalise it
    // so the dashboard doesn't show phantom "running" sessions forever.
    if (!sessions.has(session.id)) normalizeInterrupted(session);
    return session;
  });
}

/** Find sessions for a given URL origin, scoped to an organisation. */
export async function findSessionsByUrl(url: string, orgId: string): Promise<Session[]> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { origin = url; }
  const all = await listSessions(orgId);
  return all.filter(s => {
    try { return new URL(s.url).origin === origin; } catch { return s.url === url; }
  });
}

// ── State mutations (sync — fire-and-forget DB write) ─────────────────────────

export function updateSession(id: string, patch: Partial<Session>): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, patch, { updatedAt: Date.now() });
  sessions.set(id, session);
  // Strip logs from SSE update payload — logs flow via separate { type: 'log' } events
  // and are caught up cursor-by-cursor in the heartbeat.  Omitting them here keeps
  // update payloads small regardless of how many log entries accumulate.
  const { logs: _logs, ...sessionWithoutLogs } = session;
  notifySubscribers(id, { type: 'update', session: sessionWithoutLogs, logsOmitted: true });
  dbWrite(id, patchToData(patch));
  return session;
}

export function setStatus(id: string, status: SessionStatus): void {
  updateSession(id, { status });
  // Persist any buffered logs promptly when a run reaches a terminal state.
  if (status === 'complete' || status === 'failed' || status === 'idle') {
    void flushLogs();
  }
}

export function setSiteMap(id: string, siteMap: SiteMap): void {
  updateSession(id, { siteMap });
  // Denormalised page count so list views can show it without the siteMap blob.
  dbWrite(id, { pagesCount: siteMap.total_pages ?? 0 });
}

export function setFigmaResult(id: string, figmaResult: FigmaResult): void {
  updateSession(id, { figmaResult });
}

export function setFigmaChecking(id: string, checking: boolean): void {
  updateSession(id, { figmaChecking: checking });
}

export function setScenarioResult(id: string, scenarioResult: ScenarioResult): void {
  updateSession(id, { scenarioResult });
}

export function setTestResult(id: string, testResult: TestResult): void {
  updateSession(id, { testResult });
}

export function setFixResult(id: string, fixResult: FixResult): void {
  updateSession(id, { fixResult });
}

export function setTriageResult(id: string, triageResult: TriageResult | null): void {
  updateSession(id, { triageResult: triageResult as TriageResult });
}

export function setError(id: string, error: string): void {
  updateSession(id, { error, status: 'failed' });
}

/** Clear any error from a previous run — call when a fresh run starts. */
export function clearError(id: string): void {
  updateSession(id, { error: null });
}

export function setContextDoc(id: string, content: string | null, name: string | null): void {
  const patch: Partial<Session> = {};
  (patch as Record<string, unknown>)['contextDoc']     = content;
  (patch as Record<string, unknown>)['contextDocName'] = name;
  updateSession(id, patch);
}

export function addUserFlow(id: string, flow: UserFlow): void {
  const session = sessions.get(id);
  if (!session) return;
  updateSession(id, { userFlows: [...session.userFlows, flow] });
}

export function removeUserFlow(id: string, flowId: string): void {
  const session = sessions.get(id);
  if (!session) return;
  updateSession(id, { userFlows: session.userFlows.filter(f => f.id !== flowId) });
}

export function setImportedProject(id: string, importedProject: ImportedProject | null): void {
  updateSession(id, { importedProject: importedProject as ImportedProject });
}

export function setCoverageAnalysis(id: string, coverageAnalysis: CoverageAnalysis | null): void {
  updateSession(id, { coverageAnalysis: coverageAnalysis as CoverageAnalysis });
}

// ── Logging ───────────────────────────────────────────────────────────────────

// Log persistence is BATCHED: instead of one INSERT per line (thousands per run),
// lines are buffered in memory and flushed together via createMany. In-process
// SSE clients still get each line instantly via notifySubscribers; cross-process
// clients see them within one flush interval. Ordering is preserved because
// createMany assigns autoincrement ids in array order (the SSE cursor uses id).
const LOG_FLUSH_SIZE = 25;     // flush once this many lines are buffered (any session)
const LOG_FLUSH_MS   = 1_500;  // …or after this long, whichever comes first

const chunkSeq: Map<string, number> = (globalThis.__tp_chunkseq ??= new Map());
/** Keep at most this many chunks per session (oldest pruned on flush). */
const MAX_CHUNKS_PER_SESSION = 400;

async function nextSeq(sessionId: string): Promise<number> {
  const cached = chunkSeq.get(sessionId);
  if (cached !== undefined) {
    chunkSeq.set(sessionId, cached + 1);
    return cached + 1;
  }
  // Cold start — find where the sequence left off.
  let last = 0;
  try {
    const row = await prisma.sessionLogChunk.findFirst({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    last = row?.seq ?? 0;
  } catch { /* start from 0 */ }
  chunkSeq.set(sessionId, last + 1);
  return last + 1;
}

async function flushLogs(): Promise<void> {
  for (const [sid, buf] of logBuffer) {
    if (buf.length === 0) continue;
    const entries = buf.map(e => ({ ts: e.createdAt.getTime(), msg: e.message, level: e.level }));
    buf.length = 0;
    try {
      const seq = await nextSeq(sid);
      await prisma.sessionLogChunk.create({
        data: { sessionId: sid, seq, lineCount: entries.length, content: entries },
      });
      // Retention: opportunistically prune old chunks for this session.
      if (seq > MAX_CHUNKS_PER_SESSION && seq % 20 === 0) {
        await prisma.sessionLogChunk.deleteMany({
          where: { sessionId: sid, seq: { lte: seq - MAX_CHUNKS_PER_SESSION } },
        }).catch(() => {});
      }
    } catch { /* best-effort — entries stay in memory for live SSE */ }
  }
}

function scheduleLogFlush(): void {
  if (globalThis.__tp_logtimer) return;
  globalThis.__tp_logtimer = setTimeout(() => {
    globalThis.__tp_logtimer = undefined;
    void flushLogs();
  }, LOG_FLUSH_MS);
}

// ANSI escape sequences (cursor moves, line erases, colors) emitted by CLI
// tools for live terminals — meaningless once persisted, so strip them.
// Anchored on the ESC byte so plain text like "[chromium]" is never touched.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

export function addLog(id: string, msg: string, level: LogEntry['level'] = 'info'): void {
  const session = sessions.get(id);
  if (!session) return;
  msg = msg.replace(ANSI_RE, '').replace(/\r/g, '').trim();
  if (!msg) return; // nothing left after stripping control sequences
  const ts = Date.now();
  const entry: LogEntry = { ts, msg, level };
  session.logs.push(entry);
  session.updatedAt = ts;
  sessions.set(id, session);
  notifySubscribers(id, { type: 'log', entry });

  // Buffer for batched DB persistence.
  let buf = logBuffer.get(id);
  if (!buf) { buf = []; logBuffer.set(id, buf); }
  buf.push({ message: msg, level, createdAt: new Date(ts) });

  let pending = 0;
  for (const b of logBuffer.values()) pending += b.length;
  if (pending >= LOG_FLUSH_SIZE) void flushLogs();
  else scheduleLogFlush();
}

// ── SSE pub/sub (runtime-only) ────────────────────────────────────────────────

export function subscribe(id: string, controller: ReadableStreamDefaultController): void {
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id)!.add(controller);
}

export function unsubscribe(id: string, controller: ReadableStreamDefaultController): void {
  subscribers.get(id)?.delete(controller);
}

function notifySubscribers(id: string, event: unknown): void {
  const subs = subscribers.get(id);
  if (!subs || subs.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = new TextEncoder().encode(data);
  for (const ctrl of subs) {
    try { ctrl.enqueue(encoded); } catch { subs.delete(ctrl); }
  }
}
