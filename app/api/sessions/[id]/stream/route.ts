import { NextRequest } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { getSession, getCachedSession, subscribe, unsubscribe } from '@/lib/session-store';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;  // loads DB → cache on cold start
  if (!session) return new Response('Not found', { status: 404 });

  // Initialise cursor at the last log CHUNK already in the DB so the heartbeat
  // only emits logs written AFTER this SSE connection was established.
  let lastChunkId = BigInt(0);
  try {
    const last = await prisma.sessionLogChunk.findFirst({
      where: { sessionId: id },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (last) lastChunkId = last.id;
  } catch { /* non-fatal — heartbeat will start from 0 and client deduplicates */ }

  let controller: ReadableStreamDefaultController;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatRunning = false;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      subscribe(id, ctrl);

      // Send full session state (including all historical logs) on connect so the
      // client is immediately up to date.  getCachedSession is safe here because
      // the await getSession() above already populated the cache.
      const init = `data: ${JSON.stringify({ type: 'init', session: getCachedSession(id) })}\n\n`;
      ctrl.enqueue(new TextEncoder().encode(init));

      // Heartbeat: every 3 s emit a state-only update (no logs — keeps payload
      // small) followed by any new DB log rows since the last cursor position.
      // This covers two scenarios:
      //   a) The worker process writing logs is the same process — notifySubscribers
      //      already pushed each log in real-time, so the cursor poll finds nothing.
      //   b) The worker is a different process (cold-Lambda restart) — the cursor
      //      poll catches up any logs that were written to DB but never pushed here.
      heartbeat = setInterval(async () => {
        if (heartbeatRunning) return; // skip tick if previous poll is still running
        heartbeatRunning = true;
        try {
          const current = getCachedSession(id);
          if (!current) return;

          // State update — logs intentionally omitted (they flow via log events)
          const { logs: _logs, ...sessionWithoutLogs } = current;
          const stateMsg = `data: ${JSON.stringify({ type: 'update', session: sessionWithoutLogs, logsOmitted: true })}\n\n`;
          ctrl.enqueue(new TextEncoder().encode(stateMsg));

          // Cursor-based log catch-up from DB (chunked storage)
          const newChunks = await prisma.sessionLogChunk.findMany({
            where: { sessionId: id, id: { gt: lastChunkId } },
            orderBy: { id: 'asc' },
            take: 20, // cap per tick (each chunk holds ~dozens of lines)
          });
          for (const chunk of newChunks) {
            const entries = (chunk.content as unknown as Array<{ ts: number; msg: string; level: string }>) ?? [];
            for (const entry of entries) {
              const logMsg = `data: ${JSON.stringify({ type: 'log', entry })}\n\n`;
              ctrl.enqueue(new TextEncoder().encode(logMsg));
            }
            lastChunkId = chunk.id;
          }
        } catch {
          // If enqueue throws (stream closed) stop the interval
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        } finally {
          heartbeatRunning = false;
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
