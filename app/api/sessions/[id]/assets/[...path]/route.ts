import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session-store';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { Workspace } from '@/lib/pilot';
import { Readable } from 'stream';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

// Serves static files (videos, screenshots, etc.) from the session's workspace directory.
// Access pattern: /api/sessions/[id]/assets/test-results/foo/video.webm
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: segments } = await params;

  const session = getSessionOrRestore(id, req);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  // Resolve the requested path inside the workspace — prevent path traversal
  const requested = path.normalize(segments.join('/'));
  if (requested.startsWith('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filePath = path.join(workspace.dir, requested);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Not a file' }, { status: 400 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  const contentType = mimeTypes[ext] ?? 'application/octet-stream';

  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-cache',
    },
  });
}
