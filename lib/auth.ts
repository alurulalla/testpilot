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
import { cookies } from 'next/headers';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { Organization, OrgMember } from '@/lib/generated/prisma/client';

/** Cookie holding the user's currently-active org id (for multi-org users). */
export const ACTIVE_ORG_COOKIE = 'tp_org';

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export type MemberWithOrg = OrgMember & { org: Organization };

export interface AuthContext {
  clerkUserId: string;
  /** The membership row for the currently-active org. */
  member: MemberWithOrg;
  /** The currently-active org (resolved from the tp_org cookie, or the first one). */
  org: Organization;
  /** Every active membership the user has — used to render the org switcher. */
  memberships: MemberWithOrg[];
}

// ── Claim pending invites ───────────────────────────────────────────────────
// When a user authenticates, activate any OrgMember rows that were created as
// invites for their email but never claimed. This handles BOTH cases:
//   • brand-new signups (also covered by the Clerk user.created webhook), and
//   • existing users invited to an *additional* org — for whom Clerk fires no
//     user.created event, so the webhook never runs.
// Cached per request so the currentUser() round-trip happens at most once.

const claimPendingInvites = cache(async (clerkUserId: string): Promise<void> => {
  const user = await currentUser();
  if (!user) return;

  const emails = user.emailAddresses
    .map(e => e.emailAddress.toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;

  await prisma.orgMember.updateMany({
    where: {
      email: { in: emails },
      status: 'invited',
      clerkUserId: null,
    },
    data: {
      clerkUserId,
      status: 'active',
      joinedAt: new Date(),
      ...(displayName ? { displayName } : {}),
    },
  });
});

// ── Any active member ─────────────────────────────────────────────────────────
// Wrapped with React cache() so multiple Server Components on the same page
// (e.g. the page layout + a streamed child component) share one DB round-trip.

export const requireAuth: () => Promise<AuthContext> = cache(async function requireAuth() {
  const { userId } = await auth();
  if (!userId) throw new AuthError(401, 'Not authenticated');

  // Activate any invites waiting for this user before we read memberships.
  await claimPendingInvites(userId);

  const memberships = (await prisma.orgMember.findMany({
    where: { clerkUserId: userId, status: 'active' },
    include: { org: true },
    orderBy: { joinedAt: 'asc' },
  })) as MemberWithOrg[];

  if (memberships.length === 0) {
    throw new AuthError(403, 'You are not a member of any active organisation. Contact your admin.');
  }

  // Only orgs with an active licence are selectable.
  const usable = memberships.filter(m => m.org.licenseStatus === 'active');
  if (usable.length === 0) {
    throw new AuthError(403, 'Your organisation licence is suspended. Contact your admin.');
  }

  // Resolve the active org from the cookie, falling back to the first usable one.
  const activeOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const current = usable.find(m => m.orgId === activeOrgId) ?? usable[0];

  return {
    clerkUserId: userId,
    member: current,
    org: current.org,
    memberships: usable,
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
