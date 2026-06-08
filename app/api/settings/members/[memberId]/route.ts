/**
 * PATCH  /api/settings/members/[memberId]  — change role or suspend/reactivate
 * DELETE /api/settings/members/[memberId]  — remove member from org
 * POST   /api/settings/members/[memberId]  — resend invite
 */
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { requireOrgAdmin, authErrorResponse } from '@/lib/auth';

type Params = { params: Promise<{ memberId: string }> };

async function getOrgAndMember(memberId: string) {
  const ctx = await requireOrgAdmin();
  const member = await prisma.orgMember.findFirst({
    where: { id: memberId, orgId: ctx.org.id },
  });
  if (!member) throw Object.assign(new Error('Member not found'), { status: 404 });
  return { ctx, member };
}

// ── PATCH — update role / status ──────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { memberId } = await params;
  try {
    const { ctx, member } = await getOrgAndMember(memberId);

    // Prevent admin from demoting themselves
    if (member.clerkUserId === ctx.clerkUserId && (await req.clone().json() as { role?: string }).role === 'MEMBER') {
      return NextResponse.json({ error: 'You cannot remove your own admin role.' }, { status: 400 });
    }

    const { role, status } = await req.json() as { role?: string; status?: string };

    const validRoles = ['ORG_ADMIN', 'MEMBER'];
    const validStatuses = ['active', 'suspended'];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updated = await prisma.orgMember.update({
      where: { id: memberId },
      data: {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const ae = authErrorResponse(err);
    if (ae) return ae;
    if ((err as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── DELETE — remove member ────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { memberId } = await params;
  try {
    const { ctx, member } = await getOrgAndMember(memberId);

    // Prevent self-removal
    if (member.clerkUserId === ctx.clerkUserId) {
      return NextResponse.json({ error: 'You cannot remove yourself from the organisation.' }, { status: 400 });
    }

    await prisma.orgMember.delete({ where: { id: memberId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const ae = authErrorResponse(err);
    if (ae) return ae;
    if ((err as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ── POST — resend invite ──────────────────────────────────────────────────────

function appOrigin(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { memberId } = await params;
  try {
    const { ctx, member } = await getOrgAndMember(memberId);

    if (member.status !== 'invited') {
      return NextResponse.json({ error: 'Member has already joined.' }, { status: 400 });
    }

    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: member.email,
      redirectUrl: `${appOrigin(req)}/sign-up`,
      publicMetadata: { orgId: ctx.org.id, role: member.role },
      ignoreExisting: true,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const ae = authErrorResponse(err);
    if (ae) return ae;
    if ((err as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 });
  }
}
