/**
 * POST /api/figma/frames  — list the top-level frames in a Figma file.
 *
 * Body: { figmaFileUrl: string }
 * Returns: { frames: [{ name, width?, height?, suggestedPath }] }
 *
 * Used by the prepare page so the user can map each frame to a live page URL
 * before running design verification. Pure Figma API — no LLM tokens consumed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getOrgFigmaToken } from '@/lib/llm-config-store';
import { listFigmaFrames } from '@/lib/figma-client';

export async function POST(req: NextRequest) {
  let orgId: string;
  try {
    ({ org: { id: orgId } } = await requireAuth());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  const { figmaFileUrl } = await req.json().catch(() => ({})) as { figmaFileUrl?: string };
  if (!figmaFileUrl?.trim()) {
    return NextResponse.json({ error: 'figmaFileUrl is required' }, { status: 400 });
  }

  const token = await getOrgFigmaToken(orgId);
  if (!token) {
    return NextResponse.json(
      { error: 'No Figma token configured. Add one in Settings → AI → API Keys.' },
      { status: 400 },
    );
  }

  try {
    const frames = await listFigmaFrames(token, figmaFileUrl.trim());
    return NextResponse.json({ frames });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read Figma file' },
      { status: 400 },
    );
  }
}
