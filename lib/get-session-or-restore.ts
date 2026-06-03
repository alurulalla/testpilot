/**
 * getSessionOrRestore
 *
 * Looks up a session by ID, falling back to cookie-based restoration when the
 * session is not in memory (i.e. the request arrived at a different Vercel
 * Lambda container from the one that created the session).
 *
 * Priority:
 *   1. In-memory store (globalThis.__tp_sessions) — fastest, same container.
 *   2. Persisted file  (/tmp/testpilot-sessions/<id>.json) — survives warm reuse.
 *   3. Cookie          (tp-s-<id>) — crosses Lambda container boundaries.
 *
 * Returns undefined only when the session truly does not exist anywhere.
 */
import type { NextRequest } from 'next/server';
import { getSession, restoreSession, sessionCookieName, type SessionCookieData } from '@/lib/session-store';
import type { Session } from '@/types/session';

export function getSessionOrRestore(id: string, req: NextRequest): Session | undefined {
  // 1 & 2: in-memory + file fallback (already handled inside getSession)
  const found = getSession(id);
  if (found) return found;

  // 3: cookie fallback — works across Lambda container boundaries because the
  //    browser attaches the cookie to every same-origin request.
  const raw = req.cookies.get(sessionCookieName(id))?.value;
  if (!raw) return undefined;

  try {
    const data = JSON.parse(raw) as SessionCookieData;
    if (!data.url) return undefined;
    return restoreSession(id, data);
  } catch {
    return undefined;
  }
}
