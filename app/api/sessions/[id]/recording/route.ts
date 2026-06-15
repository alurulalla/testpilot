/**
 * Recording control API.
 *
 * POST /api/sessions/[id]/recording  with { action, … }:
 *   action: 'start'   { url? }                     → { recordingId, viewUrl }
 *   action: 'trace'   { recordingId }              → { actions }
 *   action: 'assert'  { recordingId, on }          → { ok }
 *   action: 'stop'    { recordingId, save?, title?, url? } → { actions, relPath?, spec? }
 *
 * The browser runs on managed Browserbase; the user drives it directly through
 * the Live View iframe, so there's no server-side input forwarding here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { recordingBackend } from '@/lib/recording/backend';
import { saveRecordingAsSpec } from '@/lib/recording/persist';

interface Body {
  action: 'start' | 'trace' | 'assert' | 'stop';
  recordingId?: string;
  url?: string;
  on?: boolean;
  save?: boolean;
  title?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const { session, ctx } = access;

  const body = await req.json().catch(() => ({})) as Body;

  try {
    switch (body.action) {
      case 'start': {
        const url = body.url || session.url;
        const handle = await recordingBackend.start({ sessionId: id, orgId: ctx.org.id, url });
        return NextResponse.json(handle);
      }
      case 'trace': {
        if (!body.recordingId) return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
        return NextResponse.json({ actions: await recordingBackend.getTrace(body.recordingId) });
      }
      case 'assert': {
        if (!body.recordingId) return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
        await recordingBackend.setAssertMode(body.recordingId, !!body.on);
        return NextResponse.json({ ok: true });
      }
      case 'stop': {
        if (!body.recordingId) return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
        const targetUrl = body.url || session.url; // client sends the URL it recorded
        const actions = await recordingBackend.stop(body.recordingId);
        if (body.save) {
          const saved = await saveRecordingAsSpec({
            sessionId: id, orgId: ctx.org.id, url: targetUrl, actions, title: body.title,
          });
          return NextResponse.json({ actions, relPath: saved.relPath, spec: saved.spec });
        }
        return NextResponse.json({ actions });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    // Surface the real cause (Browserbase session create, CDP connect, etc.) so
    // it's visible in the response instead of an opaque 500. Node's `fetch failed`
    // hides the real reason (ECONNREFUSED/ETIMEDOUT/ENOTFOUND) in `err.cause`.
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cause = (err as any)?.cause;
    const detail = cause
      ? `${message} (cause: ${cause.code ?? cause.errno ?? cause.message ?? String(cause)}${cause.address ? ` ${cause.address}:${cause.port}` : ''})`
      : message;
    console.error('[recording] action failed:', body.action, detail);
    return NextResponse.json({ error: detail, action: body.action }, { status: 500 });
  }
}
