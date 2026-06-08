/**
 * GET   /api/settings/org  — return org info for the signed-in member
 * PATCH /api/settings/org  — update org name (org admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireOrgAdmin, authErrorResponse } from '@/lib/auth';

export async function GET() {
  try {
    const { org, member } = await requireAuth();
    return NextResponse.json({ org, member });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireOrgAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { org } = await requireAuth();
  const { name } = await req.json() as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { name: name.trim() },
  });

  return NextResponse.json(updated);
}
