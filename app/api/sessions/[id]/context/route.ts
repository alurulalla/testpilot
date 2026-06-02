/**
 * GET  /api/sessions/[id]/context  — return current doc content + filename
 * POST /api/sessions/[id]/context  — upload a .md/.txt file OR paste raw text
 * DELETE /api/sessions/[id]/context — clear the doc
 *
 * On POST the route also auto-extracts any "Typical User Journey" sections
 * from the documentation and creates UserFlow entries automatically.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSession, setContextDoc, addUserFlow } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { writeContextMd } from '@/lib/build-context-md';
import type { UserFlow } from '@/types/session';

function workspace(session: { url: string }, id: string) {
  return new Workspace({ url: session.url, rootDir: path.join(process.cwd(), '.testpilot', id) });
}

/**
 * Parse "Typical User Journey" / "User Journey" / "User Flow" sections from
 * product documentation and convert each into a UserFlow entry.
 * Returns an empty array if no journey section is found.
 */
function extractJourneyFlows(content: string): UserFlow[] {
  const flows: UserFlow[] = [];
  const lines = content.split('\n');
  const JOURNEY_HEADER = /^#{1,4}\s+(Typical\s+)?(User[\s-]+Journey|User[\s-]+Flow)/i;
  const ANY_HEADER     = /^#{1,4}\s+/;

  let inJourney = false;
  let currentTitle = 'Typical User Journey';
  let steps: string[] = [];

  const flush = () => {
    if (steps.length >= 2) {           // need at least 2 steps to be a useful flow
      flows.push({
        id: randomUUID(),
        title: currentTitle,
        description: 'Auto-extracted from product documentation.',
        steps: [...steps],
        addedAt: Date.now(),
      });
    }
    steps = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.match(JOURNEY_HEADER)) {
      flush();
      inJourney = true;
      currentTitle = line.replace(/^#+\s+/, '').trim() || 'Typical User Journey';
      continue;
    }
    if (inJourney && line.match(ANY_HEADER)) {
      flush();
      inJourney = false;
      continue;
    }
    if (inJourney) {
      const nm = line.match(/^\d+[.)]\s+(.+)/);
      if (nm) { steps.push(nm[1].trim()); continue; }
      const bm = line.match(/^[-*•]\s+(.+)/);
      if (bm) { steps.push(bm[1].trim()); continue; }
    }
  }
  if (inJourney) flush();
  return flows;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    content: session.contextDoc,
    fileName: session.contextDocName,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contentType = req.headers.get('content-type') ?? '';
  let content = '';
  let fileName = 'documentation.md';

  if (contentType.includes('multipart/form-data')) {
    // File upload
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file in form data' }, { status: 400 });
    content = await file.text();
    fileName = file.name;
  } else {
    // JSON body: { content: string, fileName?: string }
    const body = await req.json().catch(() => ({})) as { content?: string; fileName?: string };
    content = body.content?.trim() ?? '';
    if (body.fileName) fileName = body.fileName;
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  // Save the documentation
  setContextDoc(id, content, fileName);

  // ── Auto-extract user journey flows ─────────────────────────────────────────
  // Parse any "Typical User Journey" sections and add them as UserFlows so the
  // user doesn't have to click "Extract Flows" manually.
  const journeyFlows = extractJourneyFlows(content);
  const existingTitles = new Set(session.userFlows.map(f => f.title.toLowerCase()));
  let addedFlows = 0;
  for (const flow of journeyFlows) {
    if (!existingTitles.has(flow.title.toLowerCase())) {
      addUserFlow(id, flow);
      existingTitles.add(flow.title.toLowerCase());
      addedFlows++;
    }
  }

  // Rebuild CONTEXT.md with the new flows included
  const freshSession = getSession(id);
  const ws = workspace(session, id);
  writeContextMd(ws.dir, content, freshSession?.userFlows ?? []);

  return NextResponse.json({
    ok: true,
    length: content.length,
    fileName,
    autoFlowsAdded: addedFlows,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  setContextDoc(id, null, null);
  const ws = workspace(session, id);
  writeContextMd(ws.dir, null, session.userFlows);

  return NextResponse.json({ ok: true });
}
