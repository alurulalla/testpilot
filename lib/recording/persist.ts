/**
 * Save a recorded trace as a real test in the session.
 *
 * Writes the generated spec to the session's workspace AND the durable
 * SessionFile table (kind: 'recorded'), and adds it to the session's testFiles
 * so it shows up and runs like any other generated test. Mirrors how the
 * scenario route persists a spec.
 */
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getSession, updateSession } from '@/lib/session-store';
import { traceToSpec } from './codegen';
import type { RecordedAction } from './types';

export interface SaveRecordingArgs {
  sessionId: string;
  orgId: string;
  url: string;                 // target the recording ran against
  actions: RecordedAction[];
  title?: string;
}

export async function saveRecordingAsSpec(
  args: SaveRecordingArgs,
): Promise<{ relPath: string; absPath: string; spec: string }> {
  const title = (args.title || 'recorded flow').trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'recorded';
  // Unique suffix so two recordings (esp. with the default title) don't overwrite
  // each other — each Stop & save is a distinct test.
  const suffix = Date.now().toString(36).slice(-5);
  const relPath = `tests/recorded-${slug}-${suffix}.spec.ts`;
  const spec = traceToSpec(args.actions, { targetUrl: args.url, title });

  const workspace = new Workspace({ url: args.url, rootDir: getSessionDir(args.sessionId, args.orgId) });
  workspace.init();
  const absPath = path.join(workspace.dir, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, spec, 'utf8');

  await prisma.sessionFile.upsert({
    where: { sessionId_path: { sessionId: args.sessionId, path: relPath } },
    create: { sessionId: args.sessionId, path: relPath, content: spec, kind: 'recorded' },
    update: { content: spec, kind: 'recorded', deletedAt: null },
  }).catch(() => {});

  // Add to the session's test file list (durable copy is the source of truth).
  const session = await getSession(args.sessionId);
  const existing = session?.testFiles ?? [];
  updateSession(args.sessionId, { testFiles: Array.from(new Set([...existing, absPath])) });

  return { relPath, absPath, spec };
}
