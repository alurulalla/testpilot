/**
 * Durable test-suite persistence.
 *
 * The per-session workspace on disk (.testpilot/<org>/<session>/) is ephemeral —
 * wiped on every redeploy/restart and not shared across replicas. These helpers
 * make the *test files* durable by mirroring them into the SessionFile table:
 *
 *   • snapshotTestFiles()  — after generation/scenario/fix/import, copy the
 *                            workspace's test files into the DB.
 *   • restoreTestFiles()   — before a run, rebuild any missing files on disk
 *                            from the DB (no-op when the disk already has them,
 *                            so local dev is unaffected).
 *
 * Everything here is best-effort and wrapped so a failure can never break a
 * working run — on error we simply fall back to whatever is already on disk.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import type { Workspace } from '@/lib/pilot';

/** Files in the workspace we treat as the durable "suite" (text only). */
function collectSuiteFiles(workspace: Workspace): { rel: string; content: string }[] {
  const out: { rel: string; content: string }[] = [];

  // All spec files + fixtures under tests/ (recursing into subfolders like tests/figma/)
  if (existsSync(workspace.testsDir)) {
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name.endsWith('.spec.ts') || e.name === 'fixtures.ts') {
          try {
            out.push({ rel: path.relative(workspace.dir, full), content: readFileSync(full, 'utf8') });
          } catch { /* skip unreadable */ }
        }
      }
    };
    walk(workspace.testsDir);
  }

  // Small sidecar artifacts that generation relies on (best-effort).
  for (const sidecar of ['features.json', 'selector-hints.json']) {
    const full = path.join(workspace.dir, sidecar);
    if (existsSync(full)) {
      try { out.push({ rel: sidecar, content: readFileSync(full, 'utf8') }); } catch { /* skip */ }
    }
  }

  return out;
}

/**
 * Mirror the workspace's current test files into the DB. Best-effort and
 * fire-and-forget-safe; never throws.
 */
/** Classify a workspace-relative path into a SessionFile kind. */
function fileKind(rel: string): string {
  if (!rel.startsWith('tests/')) return 'sidecar';
  if (rel.startsWith('tests/figma/')) return 'figma';
  const name = rel.slice('tests/'.length);
  if (name === 'fixtures.ts') return 'fixture';
  if (name.startsWith('scenario-')) return 'scenario';
  return 'generated';
}

export async function snapshotTestFiles(sessionId: string, workspace: Workspace): Promise<void> {
  try {
    const files = collectSuiteFiles(workspace);
    if (files.length === 0) return;
    // Upsert each file. (Upsert-only — we don't hard-delete rows here, so a
    // transient empty disk can't wipe the durable copy.) On content change the
    // old version is kept in previousContent (shows what self-heal changed);
    // re-snapshotting an existing path also clears any soft-delete.
    const existing = await prisma.sessionFile.findMany({
      where: { sessionId },
      select: { path: true, content: true },
    });
    const byPath = new Map(existing.map(r => [r.path, r.content]));

    await Promise.all(files.map(f => {
      const prev = byPath.get(f.rel);
      const changed = prev !== undefined && prev !== f.content;
      return prisma.sessionFile.upsert({
        where:  { sessionId_path: { sessionId, path: f.rel } },
        create: { sessionId, path: f.rel, content: f.content, kind: fileKind(f.rel) },
        update: {
          content: f.content,
          kind: fileKind(f.rel),
          deletedAt: null,
          ...(changed ? { previousContent: prev } : {}),
        },
      });
    }));
  } catch {
    // Non-fatal — the files still exist on disk for this process.
  }
}

/**
 * Soft-delete every stored file for a session (e.g. when the suite is reset
 * before importing a Playwright project) so restore won't resurrect them.
 */
export async function markAllFilesDeleted(sessionId: string): Promise<void> {
  try {
    await prisma.sessionFile.updateMany({
      where: { sessionId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  } catch { /* best-effort */ }
}

/**
 * Rebuild missing workspace files from the DB. Only writes a file when it is
 * absent on disk, so it never clobbers fresher local content. Returns the
 * number of files restored.
 */
export async function restoreTestFiles(sessionId: string, workspace: Workspace): Promise<number> {
  try {
    // Soft-deleted rows are skipped — a reset/removed spec must stay gone.
    const rows = await prisma.sessionFile.findMany({ where: { sessionId, deletedAt: null } });
    if (rows.length === 0) return 0;
    let restored = 0;
    for (const row of rows) {
      const full = path.join(workspace.dir, row.path);
      if (existsSync(full)) continue; // disk wins — don't overwrite fresher content
      try {
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, row.content, 'utf8');
        restored++;
      } catch { /* skip this file */ }
    }
    return restored;
  } catch {
    return 0;
  }
}

/**
 * Ensure the workspace exists on disk before a run: (re)create the scaffolding
 * (config/package.json), link node_modules, and restore any test files that the
 * DB has but the disk is missing (e.g. after a redeploy wiped the container).
 */
export async function ensureWorkspaceReady(sessionId: string, workspace: Workspace): Promise<number> {
  try {
    workspace.init();                       // recreate config/package.json (idempotent)
    const restored = await restoreTestFiles(sessionId, workspace);
    try { await workspace.installDeps(); } catch { /* node_modules link best-effort */ }
    return restored;
  } catch {
    // Non-fatal — fall back to whatever is already on disk.
    return 0;
  }
}
