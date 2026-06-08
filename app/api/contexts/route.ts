import { NextRequest, NextResponse } from 'next/server';
import { getUrlContext, saveUrlContext, deleteUrlContext, listUrlContexts } from '@/lib/url-context-store';
import type { ContextField } from '@/lib/url-context-store';
import { requireAuth, authErrorResponse } from '@/lib/auth';

/** GET /api/contexts          → list all contexts for the current org
 *  GET /api/contexts?url=...  → get context for a specific URL */
export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const url = req.nextUrl.searchParams.get('url');
    if (url) {
      const ctx = await getUrlContext(url, org.id);
      return ctx
        ? NextResponse.json(ctx)
        : NextResponse.json({ error: 'No context for this URL' }, { status: 404 });
    }
    return NextResponse.json(await listUrlContexts(org.id));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** POST /api/contexts  { url, fields }  → save context */
export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = await req.json() as { url?: string; fields?: ContextField[] };
    if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
    if (!Array.isArray(body.fields)) return NextResponse.json({ error: 'fields must be an array' }, { status: 400 });
    const ctx = await saveUrlContext(body.url, body.fields, org.id);
    return NextResponse.json(ctx);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** DELETE /api/contexts?url=...  → remove context */
export async function DELETE(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
    await deleteUrlContext(url, org.id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
