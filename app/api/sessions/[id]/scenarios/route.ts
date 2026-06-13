/**
 * GET    /api/sessions/[id]/scenarios            — scenarios for this session + prior ones for the same app
 * DELETE /api/sessions/[id]/scenarios?scenarioId=…&removeTest=true|false
 *
 * Deleting a scenario optionally removes its generated test from the suite too.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rmSync } from 'fs';
import path from 'path';
import { requireSessionAccess } from '@/lib/session-access';
import { updateSession } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import {
  listSessionScenarios, listPriorScenarios, getScenario, deleteScenario, originOf,
} from '@/lib/scenarios';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const { session, ctx } = access;

  const [current, prior] = await Promise.all([
    listSessionScenarios(id),
    listPriorScenarios(ctx.org.id, session.url, id),
  ]);
  return NextResponse.json({ current, prior });
}

/**
 * POST /api/sessions/[id]/scenarios  { fromScenarioId }
 * Re-add a scenario the org previously created for this app: copy its generated
 * spec (from the DB — zero LLM tokens) into this session's suite.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const { session, ctx } = access;

  const { fromScenarioId } = await req.json().catch(() => ({})) as { fromScenarioId?: string };
  if (!fromScenarioId) return NextResponse.json({ error: 'fromScenarioId is required' }, { status: 400 });

  const src = await getScenario(fromScenarioId);
  if (!src || src.orgId !== ctx.org.id || !src.testPath) {
    return NextResponse.json({ error: 'Source scenario has no reusable test' }, { status: 404 });
  }

  // Pull the spec content from the source session's durable copy.
  const srcFile = await prisma.sessionFile.findUnique({
    where: { sessionId_path: { sessionId: src.sessionId, path: src.testPath } },
    select: { content: true },
  });
  if (!srcFile) {
    return NextResponse.json({ error: 'Source test no longer available' }, { status: 404 });
  }

  // Write into this session's workspace (disk + DB) and add to the suite.
  const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(id, session.orgId) });
  workspace.init();
  const abs = path.join(workspace.dir, src.testPath);
  try {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, srcFile.content, 'utf8');
  } catch {
    return NextResponse.json({ error: 'Could not write test file' }, { status: 500 });
  }

  await prisma.sessionFile.upsert({
    where: { sessionId_path: { sessionId: id, path: src.testPath } },
    create: { sessionId: id, path: src.testPath, content: srcFile.content, kind: 'scenario' },
    update: { content: srcFile.content, kind: 'scenario', deletedAt: null },
  });
  await prisma.scenario.upsert({
    where: { sessionId_description: { sessionId: id, description: src.description } },
    create: {
      orgId: ctx.org.id, sessionId: id, urlOrigin: originOf(session.url), description: src.description,
      testPath: src.testPath, lastStatus: 'added',
    },
    update: { testPath: src.testPath },
  }).catch(() => {});

  const updatedFiles = Array.from(new Set([...(session.testFiles ?? []), abs]));
  updateSession(id, { testFiles: updatedFiles });

  // Return the absolute path so the client can immediately run just this test
  // and merge its result into the existing suite results.
  return NextResponse.json({ ok: true, testFile: abs, relPath: src.testPath });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const { session } = access;

  const scenarioId = req.nextUrl.searchParams.get('scenarioId');
  const removeTest = req.nextUrl.searchParams.get('removeTest') === 'true';
  if (!scenarioId) return NextResponse.json({ error: 'scenarioId is required' }, { status: 400 });

  const scenario = await getScenario(scenarioId);
  if (!scenario || scenario.sessionId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await deleteScenario(scenarioId);

  // Optionally remove the generated test for this scenario from the suite.
  if (removeTest && scenario.testPath) {
    try {
      // Soft-delete the durable copy so a restore won't bring it back.
      await prisma.sessionFile.updateMany({
        where: { sessionId: id, path: scenario.testPath, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      // Remove from disk + the session's testFiles list.
      const workspace = new Workspace({ url: session.url, rootDir: getSessionDir(id, session.orgId) });
      const abs = path.join(workspace.dir, scenario.testPath);
      try { rmSync(abs, { force: true }); } catch { /* ignore */ }
      updateSession(id, { testFiles: (session.testFiles ?? []).filter(f => f !== abs) });
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, removedTest: removeTest && !!scenario.testPath });
}
