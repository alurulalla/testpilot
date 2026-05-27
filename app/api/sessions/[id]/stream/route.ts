import { NextRequest } from 'next/server';
import { getSession, subscribe, unsubscribe } from '@/lib/session-store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return new Response('Not found', { status: 404 });

  let controller: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      subscribe(id, ctrl);
      // Send current state immediately
      const init = `data: ${JSON.stringify({ type: 'init', session })}\n\n`;
      ctrl.enqueue(new TextEncoder().encode(init));
    },
    cancel() {
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
