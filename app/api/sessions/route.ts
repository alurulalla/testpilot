import { NextRequest, NextResponse } from 'next/server';
import { createSession, listSessions, findSessionsByUrl } from '@/lib/session-store';
import { getMaxPages } from '@/lib/config';

/** GET /api/sessions          → all sessions
 *  GET /api/sessions?url=...  → sessions matching that URL (origin) */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (url) return NextResponse.json(findSessionsByUrl(url));
  return NextResponse.json(listSessions());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string; figmaFileUrl?: string; figmaOnly?: boolean };
  const { url, figmaFileUrl, figmaOnly } = body;
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  const session = createSession(url, getMaxPages(), false, figmaFileUrl ?? null, figmaOnly ?? false);
  return NextResponse.json(session, { status: 201 });
}
