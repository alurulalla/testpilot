import { NextRequest, NextResponse } from 'next/server';
import { createSession, listSessions, findSessionsByUrl, sessionCookieName, type SessionCookieData } from '@/lib/session-store';
import { getMaxPages } from '@/lib/config';

/** GET /api/sessions          → all sessions
 *  GET /api/sessions?url=...  → sessions matching that URL (origin) */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (url) return NextResponse.json(findSessionsByUrl(url));
  return NextResponse.json(listSessions());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string; figmaFileUrl?: string };
  const { url, figmaFileUrl } = body;
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  // maxPages comes from env (MAX_PAGES); headedMode defaults to false and can be toggled on the session page
  const session = createSession(url, getMaxPages(), false, figmaFileUrl ?? null);

  // Persist essential session config in a cookie so any Vercel Lambda container
  // that handles a subsequent request can restore the session from it.
  // Cookies travel with every browser request regardless of which Lambda handles it.
  const cookieData: SessionCookieData = {
    url: session.url,
    maxPages: session.maxPages,
    headedMode: session.headedMode,
    figmaFileUrl: session.figmaFileUrl,
  };
  const res = NextResponse.json(session, { status: 201 });
  res.cookies.set(sessionCookieName(session.id), JSON.stringify(cookieData), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour
    path: '/',
  });
  return res;
}
