import { NextRequest, NextResponse } from 'next/server';
import { getUrlContext, saveUrlContext, deleteUrlContext, listUrlContexts, ContextField } from '@/lib/url-context-store';

/** GET /api/contexts          → list all
 *  GET /api/contexts?url=...  → get context for specific URL */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (url) {
    const ctx = getUrlContext(url);
    return ctx
      ? NextResponse.json(ctx)
      : NextResponse.json({ error: 'No context for this URL' }, { status: 404 });
  }
  return NextResponse.json(listUrlContexts());
}

/** POST /api/contexts  { url, fields }  → save context */
export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string; fields?: ContextField[] };
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (!Array.isArray(body.fields)) return NextResponse.json({ error: 'fields must be an array' }, { status: 400 });
  const ctx = saveUrlContext(body.url, body.fields);
  return NextResponse.json(ctx);
}

/** DELETE /api/contexts?url=...  → remove context */
export async function DELETE(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  deleteUrlContext(url);
  return NextResponse.json({ deleted: true });
}
