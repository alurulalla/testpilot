/**
 * GET   /api/admin/orgs/[id]  — org detail with members
 * PATCH /api/admin/orgs/[id]  — update name, licenseStatus, maxMembers
 */
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// ── GET — org detail ──────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      members: { orderBy: { invitedAt: 'desc' } },
      _count: { select: { sessions: true } },
    },
  });

  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });
  return NextResponse.json(org);
}

// ── PATCH — update org ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { id } = await params;
  const body = await req.json() as {
    name?: string;
    licenseStatus?: string;
    maxMembers?: number;
  };

  const validStatuses = ['active', 'suspended', 'expired'];
  if (body.licenseStatus && !validStatuses.includes(body.licenseStatus)) {
    return NextResponse.json({ error: 'Invalid licenseStatus' }, { status: 400 });
  }

  const updated = await prisma.organization.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.licenseStatus ? { licenseStatus: body.licenseStatus } : {}),
      ...(body.maxMembers ? { maxMembers: body.maxMembers } : {}),
    },
  });

  return NextResponse.json(updated);
}

// ── POST /api/admin/orgs/[id]/resend-invite ────────────────────────────────────
// Handled via a separate route file below, but the re-invite logic lives here
// as a named export for clarity.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { id } = await params;
  const { email } = await req.json() as { email?: string };
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  // Verify the member belongs to this org
  const member = await prisma.orgMember.findFirst({
    where: { orgId: id, email: email.toLowerCase() },
  });
  if (!member) return NextResponse.json({ error: 'Member not found in this org' }, { status: 404 });

  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email.toLowerCase(),
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/sign-up`,
      publicMetadata: { orgId: id, role: member.role },
      ignoreExisting: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to send invite: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
