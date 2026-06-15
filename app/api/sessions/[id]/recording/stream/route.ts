/**
 * GET /api/sessions/[id]/recording/stream?recordingId=…
 *
 * Server-Sent Events stream for the live action list:
 *   { type: 'trace', actions: [...] }  — what's been recorded so far (every ~1s)
 *   { type: 'ended' }                  — the recording session has closed
 *
 * The browser pixels are rendered by Browserbase's Live View iframe, not here.
 * SSE is used (not WebSocket) so it works under `next start` on Railway, the
 * same way the logs stream does.
 */
import { NextRequest } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { recordingBackend } from '@/lib/recording/backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;

  const recordingId = req.nextUrl.searchParams.get('recordingId');
  if (!recordingId) return new Response('recordingId required', { status: 400 });

  const enc = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(ctrl) {
      const send = (obj: unknown) => {
        try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };

      // Live action list every second so the user sees what's being recorded.
      heartbeat = setInterval(() => {
        if (!recordingBackend.isLive(recordingId)) { send({ type: 'ended' }); return; }
        void recordingBackend.getTrace(recordingId).then(actions => send({ type: 'trace', actions }));
      }, 1000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
