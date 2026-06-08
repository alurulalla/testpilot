/**
 * GET  /api/settings/members  — list all members in the org
 * POST /api/settings/members  — invite a new member (org admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireOrgAdmin, authErrorResponse } from '@/lib/auth';

export async function GET() {
  try {
    const { org } = await requireAuth();
    const members = await prisma.orgMember.findMany({
      where: { orgId: org.id },
      orderBy: { invitedAt: 'desc' },
    });
    return NextResponse.json(members);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/** Derive the public-facing app origin for invitation redirect URLs.
 *  Priority: explicit env var → origin of the incoming request. */
function appOrigin(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  let orgCtx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    orgCtx = await requireOrgAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { org } = orgCtx;
  const { email, role = 'MEMBER' } = await req.json() as { email?: string; role?: string };

  if (!email?.trim()) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  if (!['ORG_ADMIN', 'MEMBER'].includes(role)) {
    return NextResponse.json({ error: 'role must be ORG_ADMIN or MEMBER' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Enforce member limit (count active + invited)
  const currentCount = await prisma.orgMember.count({
    where: { orgId: org.id, status: { in: ['active', 'invited'] } },
  });
  if (currentCount >= org.maxMembers) {
    return NextResponse.json(
      { error: `Member limit reached (${org.maxMembers}). Contact your administrator to increase the limit.` },
      { status: 409 },
    );
  }

  // Check if already a member
  const existing = await prisma.orgMember.findUnique({
    where: { orgId_email: { orgId: org.id, email: normalizedEmail } },
  });
  if (existing) {
    return NextResponse.json({ error: 'This email is already a member of your organisation.' }, { status: 409 });
  }

  // Create the member record
  const member = await prisma.orgMember.create({
    data: {
      orgId: org.id,
      email: normalizedEmail,
      role,
      status: 'invited',
    },
  });

  // Send Clerk invitation
  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: normalizedEmail,
      redirectUrl: `${appOrigin(req)}/sign-up`,
      publicMetadata: { orgId: org.id, role },
      ignoreExisting: true,
    });
  } catch (inviteErr) {
    console.error('Clerk invite failed:', inviteErr);
    return NextResponse.json(
      { member, warning: 'Member added but invite email failed. Resend from the members list.' },
      { status: 201 },
    );
  }

  return NextResponse.json({ member }, { status: 201 });
}
