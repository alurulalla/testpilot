/**
 * GET  /api/settings/api-keys  — list configured keys (masked values only)
 * POST /api/settings/api-keys  — add or rotate a key
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encrypt, maskApiKey } from '@/lib/crypto';
import { requireOrgAdmin, authErrorResponse } from '@/lib/auth';
import { PROVIDERS } from '@/lib/pilot/providers';

// Keys configurable per org — derived from the provider registry (the same source
// the Settings UI builds its key fields from) plus the Figma token, so adding a
// provider automatically accepts its key and the UI/backend never drift.
export const SUPPORTED_KEY_NAMES: string[] = [
  ...new Set(
    PROVIDERS
      .filter(p => p.apiKeyRequired && p.apiKeyEnvVar)
      .map(p => p.apiKeyEnvVar as string),
  ),
  'FIGMA_TOKEN',
];

export async function GET() {
  try {
    const { org } = await requireOrgAdmin();
    const rows = await prisma.orgApiKey.findMany({
      where: { orgId: org.id },
      select: { id: true, keyName: true, maskedValue: true, updatedAt: true },
      orderBy: { keyName: 'asc' },
    });
    return NextResponse.json(rows);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireOrgAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { org } = await requireOrgAdmin();
  const { keyName, keyValue } = await req.json() as { keyName?: string; keyValue?: string };

  if (!keyName || !SUPPORTED_KEY_NAMES.includes(keyName)) {
    return NextResponse.json(
      { error: `keyName must be one of: ${SUPPORTED_KEY_NAMES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!keyValue?.trim()) {
    return NextResponse.json({ error: 'keyValue is required' }, { status: 400 });
  }

  const trimmed = keyValue.trim();
  const encrypted = encrypt(trimmed);
  const masked = maskApiKey(trimmed);

  const row = await prisma.orgApiKey.upsert({
    where: { orgId_keyName: { orgId: org.id, keyName } },
    create: { orgId: org.id, keyName, keyValue: encrypted, maskedValue: masked },
    update: { keyValue: encrypted, maskedValue: masked },
    select: { id: true, keyName: true, maskedValue: true, updatedAt: true },
  });

  return NextResponse.json(row);
}
