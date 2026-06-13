/**
 * Cross-tenant access guard for /api/sessions/[id]/* routes.
 *
 * Clerk's middleware only guarantees the caller is signed in — it does NOT
 * check that they belong to the organisation that owns the session. Every
 * session route must call requireSessionAccess() so a member of org B can
 * never read or act on org A's sessions (logs, credentials, runs, downloads).
 *
 * Returns a discriminated union instead of throwing so call sites stay a
 * simple two-line guard:
 *
 *   const access = await requireSessionAccess(id);
 *   if ('error' in access) return access.error;
 *   const { session } = access;
 */
import { NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getSession } from '@/lib/session-store';
import type { Session } from '@/types/session';
import type { AuthContext } from '@/lib/auth';

export type SessionAccess =
  | { session: Session; ctx: AuthContext }
  | { error: Response };

export async function requireSessionAccess(id: string): Promise<SessionAccess> {
  let ctx: AuthContext;
  try {
    ctx = await requireAuth();
  } catch (err) {
    const r = authErrorResponse(err);
    return { error: r ?? NextResponse.json({ error: 'Server error' }, { status: 500 }) };
  }

  const session = await getSession(id);
  // Same 404 for "doesn't exist" and "not your org" — don't leak which it is.
  if (!session || session.orgId !== ctx.org.id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  return { session, ctx };
}
