import { NextRequest, NextResponse } from 'next/server';
import { createSession, listSessions, findSessionsByUrl } from '@/lib/session-store';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getOrgSettings } from '@/lib/org-settings';

/** GET /api/sessions          → all sessions for the current org
 *  GET /api/sessions?url=...  → sessions matching that URL (origin) */
export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const url = req.nextUrl.searchParams.get('url');
    if (url) return NextResponse.json(await findSessionsByUrl(url, org.id));
    return NextResponse.json(await listSessions(org.id));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { org, clerkUserId } = await requireAuth();
    const body = await req.json() as {
      url?: string; figmaFileUrl?: string; figmaOnly?: boolean;
      figmaFrameMap?: Record<string, string>;
    };
    const { url, figmaFileUrl, figmaOnly, figmaFrameMap } = body;
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
    const { maxPages } = await getOrgSettings(org.id);
    const session = await createSession(
      url,
      maxPages,
      false,
      figmaFileUrl ?? null,
      figmaOnly ?? false,
      org.id,
      clerkUserId,
      figmaFrameMap && Object.keys(figmaFrameMap).length > 0 ? figmaFrameMap : null,
    );
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
