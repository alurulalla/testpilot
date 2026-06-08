/**
 * GET  /api/admin/orgs  — list all orgs with member + session counts
 * POST /api/admin/orgs  — create a new org and invite the first org admin
 */
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth';

// ── GET — list all orgs ───────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true, sessions: true } },
    },
  });

  return NextResponse.json(orgs);
}

// ── POST — create org ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let superAdmin: { email: string };
  try {
    superAdmin = await requireSuperAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const body = await req.json() as {
    name?: string;
    slug?: string;
    maxMembers?: number;
    adminEmail?: string;
  };

  const { name, slug, maxMembers = 5, adminEmail } = body;

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!slug?.trim()) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  if (!adminEmail?.trim()) return NextResponse.json({ error: 'adminEmail is required' }, { status: 400 });

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must be lowercase letters, numbers, and hyphens only' },
      { status: 400 },
    );
  }

  // Check slug uniqueness
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: `Slug "${slug}" is already taken` }, { status: 409 });
  }

  // Create org + first admin member in a transaction
  const org = await prisma.$transaction(async tx => {
    const newOrg = await tx.organization.create({
      data: {
        name: name.trim(),
        slug: slug.trim(),
        maxMembers,
        createdByAdmin: superAdmin.email,
      },
    });

    await tx.orgMember.create({
      data: {
        orgId: newOrg.id,
        email: adminEmail.trim().toLowerCase(),
        role: 'ORG_ADMIN',
        status: 'invited',
      },
    });

    return newOrg;
  });

  // Send Clerk invitation email to the org admin
  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: adminEmail.trim().toLowerCase(),
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/sign-up`,
      publicMetadata: { orgId: org.id, role: 'ORG_ADMIN' },
      ignoreExisting: true,
    });
  } catch (inviteErr) {
    // Invitation sending failed — org + member are already created.
    // Admin can re-send the invite manually. Log and continue.
    console.error('Failed to send Clerk invite:', inviteErr);
    return NextResponse.json({
      org,
      warning: 'Org created but invite email failed to send. Re-send from the org detail page.',
    }, { status: 201 });
  }

  return NextResponse.json({ org }, { status: 201 });
}
