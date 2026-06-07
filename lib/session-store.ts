import { Session, LogEntry, SessionStatus, SiteMap, TestResult, FixResult, FigmaResult, ScenarioResult, UserFlow, TriageResult, ImportedProject, CoverageAnalysis } from '@/types/session';
import { randomUUID } from 'crypto';
import type { ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// ── File-based session persistence ─────────────────────────────────────────────
//
// On Vercel, each serverless function invocation can run in a different
// Lambda container with its own empty memory. To survive SSE reconnections
// (which may land on a fresh container), we persist each session to a temp
// file after every write. On read, if the session is not in memory we fall
// back to the file. This keeps things working without any external database.
//
// On local dev the same code path is used — tmpdir() is /tmp on macOS/Linux
// so the files are also written there, which is harmless.

const SESSION_DIR = path.join(tmpdir(), 'testpilot-sessions');

// Debounce timers — avoid hammering the filesystem on rapid log bursts.
// The session is written to disk at most once per 500 ms per session ID.
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sessionFilePath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

function persistSession(id: string, session: Session): void {
  // Cancel any pending write for this session and schedule a fresh one.
  const existing = persistTimers.get(id);
  if (existing) clearTimeout(existing);
  persistTimers.set(id, setTimeout(() => {
    persistTimers.delete(id);
    try {
      mkdirSync(SESSION_DIR, { recursive: true });
      writeFileSync(sessionFilePath(id), JSON.stringify(session), 'utf8');
    } catch {
      // Non-fatal — in-memory store is still the source of truth
    }
  }, 500));
}

function loadPersistedSession(id: string): Session | undefined {
  try {
    const raw = readFileSync(sessionFilePath(id), 'utf8');
    return JSON.parse(raw) as Session;
  } catch {
    return undefined;
  }
}

// Turbopack and Next.js dev mode can create multiple module instances.
// Pinning state to globalThis ensures all instances share the same Map.
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

const sessions: Map<string, Session> = (globalThis.__tp_sessions ??= new Map());
const subscribers: Map<string, Set<ReadableStreamDefaultController>> = (globalThis.__tp_subscribers ??= new Map());
const stopping: Set<string> = (globalThis.__tp_stopping ??= new Set());
const runningProcesses: Map<string, ChildProcess> = (globalThis.__tp_processes ??= new Map());

export function markStopping(id: string): void { stopping.add(id); }
export function clearStopping(id: string): void { stopping.delete(id); }
export function isStopping(id: string): boolean { return stopping.has(id); }

export function registerProcess(id: string, proc: ChildProcess): void { runningProcesses.set(id, proc); }
export function unregisterProcess(id: string): void { runningProcesses.delete(id); }
export function killProcess(id: string): void {
  const proc = runningProcesses.get(id);
  if (proc) { try { proc.kill('SIGTERM'); } catch { /* already dead */ } }
  runningProcesses.delete(id);
}

export function createSession(url: string, maxPages = 10, headedMode = false, figmaFileUrl: string | null = null, figmaOnly = false): Session {
  const id = randomUUID();
  const session: Session = {
    id,
    url,
    status: 'idle',
    logs: [],
    siteMap: null,
    testFiles: [],
    testResult: null,
    fixResult: null,
    figmaResult: null,
    figmaFileUrl,
    figmaOnly,
    figmaChecking: false,
    iteration: 0,
    error: null,
    maxPages,
    headedMode,
    scenarioResult: null,
    triageResult: null,
    contextDoc: null,
    contextDocName: null,
    userFlows: [],
    importedProject: null,
    coverageAnalysis: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  persistSession(id, session);
  return session;
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

export function getSession(id: string): Session | undefined {
  const inMemory = sessions.get(id);
  if (inMemory) return inMemory;
  // Fallback: restore from file in case the process restarted (e.g. Railway redeploy).
  const persisted = loadPersistedSession(id);
  if (persisted) {
    sessions.set(id, persisted);
    return persisted;
  }
  return undefined;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Find sessions for a given URL (origin match — ignores path/query). */
export function findSessionsByUrl(url: string): Session[] {
  let origin: string;
  try { origin = new URL(url).origin; } catch { origin = url; }
  return Array.from(sessions.values())
    .filter(s => { try { return new URL(s.url).origin === origin; } catch { return s.url === url; } })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function updateSession(id: string, patch: Partial<Session>): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, patch, { updatedAt: Date.now() });
  sessions.set(id, session);
  notifySubscribers(id, { type: 'update', session });
  persistSession(id, session);
  return session;
}

export function setStatus(id: string, status: SessionStatus): void {
  updateSession(id, { status });
}

export function setSiteMap(id: string, siteMap: SiteMap): void {
  updateSession(id, { siteMap });
}

export function setTestResult(id: string, testResult: TestResult): void {
  updateSession(id, { testResult });
}

export function setFixResult(id: string, fixResult: FixResult): void {
  updateSession(id, { fixResult });
}

export function setTriageResult(id: string, triageResult: TriageResult | null): void {
  updateSession(id, { triageResult });
}

export function setError(id: string, error: string): void {
  updateSession(id, { error, status: 'failed' });
}

export function setContextDoc(id: string, content: string | null, name: string | null): void {
  updateSession(id, { contextDoc: content, contextDocName: name });
}

export function addUserFlow(id: string, flow: UserFlow): void {
  const session = sessions.get(id);
  if (!session) return;
  updateSession(id, { userFlows: [...session.userFlows, flow] });
}

export function setImportedProject(id: string, importedProject: ImportedProject | null): void {
  updateSession(id, { importedProject });
}

export function setCoverageAnalysis(id: string, coverageAnalysis: CoverageAnalysis | null): void {
  updateSession(id, { coverageAnalysis });
}

export function removeUserFlow(id: string, flowId: string): void {
  const session = sessions.get(id);
  if (!session) return;
  updateSession(id, { userFlows: session.userFlows.filter(f => f.id !== flowId) });
}

export function addLog(id: string, msg: string, level: LogEntry['level'] = 'info'): void {
  const session = sessions.get(id);
  if (!session) return;
  const entry: LogEntry = { ts: Date.now(), msg, level };
  session.logs.push(entry);
  session.updatedAt = Date.now();
  sessions.set(id, session);
  notifySubscribers(id, { type: 'log', entry });
  persistSession(id, session);
}

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
    try {
      ctrl.enqueue(encoded);
    } catch {
      subs.delete(ctrl);
    }
  }
}
