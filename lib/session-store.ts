import { Session, LogEntry, SessionStatus, SiteMap, TestResult, FixResult, FigmaResult, ScenarioResult } from '@/types/session';
import { randomUUID } from 'crypto';
import type { ChildProcess } from 'child_process';

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

export function createSession(url: string, maxPages = 10, headedMode = false, figmaFileUrl: string | null = null): Session {
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
    iteration: 0,
    error: null,
    maxPages,
    headedMode,
    scenarioResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function setFigmaResult(id: string, figmaResult: FigmaResult): void {
  updateSession(id, { figmaResult });
}

export function setScenarioResult(id: string, scenarioResult: ScenarioResult): void {
  updateSession(id, { scenarioResult });
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
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

export function setError(id: string, error: string): void {
  updateSession(id, { error, status: 'failed' });
}

export function addLog(id: string, msg: string, level: LogEntry['level'] = 'info'): void {
  const session = sessions.get(id);
  if (!session) return;
  const entry: LogEntry = { ts: Date.now(), msg, level };
  session.logs.push(entry);
  session.updatedAt = Date.now();
  sessions.set(id, session);
  notifySubscribers(id, { type: 'log', entry });
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
