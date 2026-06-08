/**
 * DELETE /api/settings/api-keys/[keyName]  — remove a configured key
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOrgAdmin, authErrorResponse } from '@/lib/auth';

type Params = { params: Promise<{ keyName: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireOrgAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { org } = await requireOrgAdmin();
  const { keyName } = await params;

  await prisma.orgApiKey.deleteMany({
    where: { orgId: org.id, keyName },
  });

  return NextResponse.json({ ok: true });
}
