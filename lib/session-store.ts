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
}

const sessions: Map<string, Session>    = (globalThis.__tp_sessions    ??= new Map());
const subscribers: Map<string, Set<ReadableStreamDefaultController>> =
                                          (globalThis.__tp_subscribers ??= new Map());
const stopping: Set<string>             = (globalThis.__tp_stopping    ??= new Set());
const runningProcesses: Map<string, ChildProcess> =
                                          (globalThis.__tp_processes   ??= new Map());

// ── DB ↔ Session conversion ───────────────────────────────────────────────────

type DbRow = Awaited<ReturnType<typeof prisma.session.findUniqueOrThrow>>;
type DbLog = { id: bigint; message: string; level: string; createdAt: Date };

function dbToSession(row: DbRow, logs: DbLog[] = []): Session {
  return {
    id:              row.id,
    orgId:           row.orgId,
    createdByUserId: row.createdByUserId,
    url:             row.url,
    status:          row.status as SessionStatus,
    figmaFileUrl:    row.figmaFileUrl  ?? null,
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
    logs: logs.map(l => ({
      ts:    l.createdAt.getTime(),
      msg:   l.message,
      level: l.level as LogEntry['level'],
    })),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

// ── Write helpers ─────────────────────────────────────────────────────────────

const JSON_FIELDS = [
  'siteMap', 'figmaResult', 'testFiles', 'testResult', 'fixResult',
  'triageResult', 'scenarioResult', 'importedProject', 'coverageAnalysis',
  'userFlows',
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
): Promise<Session> {
  const row = await prisma.session.create({
    data: {
      orgId,
      createdByUserId,
      url,
      maxPages,
      headedMode,
      figmaFileUrl: figmaFileUrl ?? undefined,
      figmaOnly,
      userFlows: [],
    },
  });
  const session = dbToSession(row);
  sessions.set(row.id, session);
  return session;
}

/**
 * Load a session — L1 cache first, then DB.
 * Populates the cache so subsequent synchronous getCachedSession() calls work.
 */
export async function getSession(id: string): Promise<Session | undefined> {
  const cached = sessions.get(id);
  if (cached) return cached;
  // Cache miss (e.g. after server restart) — load from DB
  const row = await prisma.session.findUnique({
    where: { id },
    include: { logs: { orderBy: { id: 'asc' } } },
  });
  if (!row) return undefined;
  const session = dbToSession(row, row.logs);
  sessions.set(id, session);
  return session;
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
  const rows = await prisma.session.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    // No `include: { logs }` — dashboard/list endpoints don't need log history.
  });
  return rows.map(r => dbToSession(r)); // logs: [] — correct for list views
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
}

export function setSiteMap(id: string, siteMap: SiteMap): void {
  updateSession(id, { siteMap });
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

export function addLog(id: string, msg: string, level: LogEntry['level'] = 'info'): void {
  const session = sessions.get(id);
  if (!session) return;
  const entry: LogEntry = { ts: Date.now(), msg, level };
  session.logs.push(entry);
  session.updatedAt = Date.now();
  sessions.set(id, session);
  notifySubscribers(id, { type: 'log', entry });
  // Persist to DB so SSE heartbeats can stream logs via cursor to cross-process clients.
  prisma.sessionLog.create({ data: { sessionId: id, message: msg, level } }).catch(() => {});
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
