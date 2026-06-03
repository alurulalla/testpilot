import { NextRequest } from 'next/server';
import { getSession, subscribe, unsubscribe } from '@/lib/session-store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return new Response('Not found', { status: 404 });

  let controller: ReadableStreamDefaultController;
  // Heartbeat interval — keeps the stream open AND sends periodic state
  // snapshots so clients that reconnected to a different Lambda container
  // still see progress even when push notifications can't cross containers.
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      subscribe(id, ctrl);
      // Send current state immediately so the client is up to date on connect.
      const init = `data: ${JSON.stringify({ type: 'init', session: getSession(id) })}\n\n`;
      ctrl.enqueue(new TextEncoder().encode(init));

      // Every 3 seconds re-read the session (picks up file-persisted updates
      // from another Lambda container running the loop) and send a full update.
      heartbeat = setInterval(() => {
        try {
          const current = getSession(id);
          if (!current) return;
          const msg = `data: ${JSON.stringify({ type: 'update', session: current })}\n\n`;
          ctrl.enqueue(new TextEncoder().encode(msg));
        } catch {
          // Stream was already closed — clear the interval.
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        }
      }, 3000);
    },
    cancel() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      unsubscribe(id, controller);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
