/**
 * Auth helpers for TestPilot API routes.
 *
 * Three levels:
 *   requireAuth()        → any active org member
 *   requireOrgAdmin()    → ORG_ADMIN role only
 *   requireSuperAdmin()  → email in SUPER_ADMIN_EMAILS env var
 *
 * Usage in an API route:
 *   const { member, org } = await requireAuth();
 *
 * Throws AuthError with appropriate HTTP status on failure.
 * Callers should catch and return NextResponse.json({ error }, { status }).
 */
import { cache } from 'react';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { Organization, OrgMember } from '@/lib/generated/prisma/client';

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthContext {
  clerkUserId: string;
  member: OrgMember;
  org: Organization;
}

// ── Any active member ─────────────────────────────────────────────────────────
// Wrapped with React cache() so multiple Server Components on the same page
// (e.g. the page layout + a streamed child component) share one DB round-trip.

export const requireAuth: () => Promise<AuthContext> = cache(async function requireAuth() {
  const { userId } = await auth();
  if (!userId) throw new AuthError(401, 'Not authenticated');

  const member = await prisma.orgMember.findFirst({
    where: { clerkUserId: userId, status: 'active' },
    include: { org: true },
  });

  if (!member) {
    throw new AuthError(403, 'You are not a member of any active organisation. Contact your admin.');
  }

  if ((member as OrgMember & { org: Organization }).org.licenseStatus !== 'active') {
    throw new AuthError(403, 'Your organisation licence is suspended. Contact your admin.');
  }

  return {
    clerkUserId: userId,
    member,
    org: (member as OrgMember & { org: Organization }).org,
  };
});

// ── Org admin only ────────────────────────────────────────────────────────────

export async function requireOrgAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.member.role !== 'ORG_ADMIN') {
    throw new AuthError(403, 'Organisation admin access required');
  }
  return ctx;
}

// ── Super admin only ──────────────────────────────────────────────────────────

export async function requireSuperAdmin(): Promise<{ clerkUserId: string; email: string }> {
  const { userId } = await auth();
  if (!userId) throw new AuthError(401, 'Not authenticated');

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? '';

  const adminEmails = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!email || !adminEmails.includes(email.toLowerCase())) {
    throw new AuthError(403, 'Super admin access required');
  }

  return { clerkUserId: userId, email };
}

// ── Convenience: turn AuthError into a NextResponse ──────────────────────────

export function authErrorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null; // not an auth error — let the caller handle it
}
