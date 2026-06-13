/**
 * Node-only startup tasks (imported conditionally from instrumentation.ts so
 * the Edge bundle never traces the fs/prisma imports).
 *
 * Workspace cleanup: with a persistent volume mounted at .testpilot/, deleted
 * sessions would otherwise leave their workspace folders (tests, videos,
 * screenshots) behind forever. On boot we remove folders whose session no
 * longer exists in the database.
 *
 * Conservative by design: only directories whose names look like generated ids
 * (cuid/uuid) AND match neither a live session id nor an organisation id are
 * removed. Anything unrecognised is left alone. Failures never block startup.
 */
import { readdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

export async function sweepOrphanWorkspaces(): Promise<void> {
  try {
    const root = path.join(process.cwd(), '.testpilot');
    if (!existsSync(root)) return;

    const [sessions, orgs] = await Promise.all([
      prisma.session.findMany({ select: { id: true } }),
      prisma.organization.findMany({ select: { id: true } }),
    ]);
    const sessionIds = new Set(sessions.map(s => s.id));
    const orgIds     = new Set(orgs.map(o => o.id));

    // cuid (c…) or uuid — the only shapes our generated dirs ever have.
    const ID_RE = /^(c[a-z0-9]{20,})$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let removed = 0;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // skip app-settings.json etc.
      const name = entry.name;
      const full = path.join(root, name);

      if (orgIds.has(name)) {
        // Org folder → its children are session folders; sweep orphans inside.
        for (const child of readdirSync(full, { withFileTypes: true })) {
          if (!child.isDirectory()) continue;
          if (ID_RE.test(child.name) && !sessionIds.has(child.name)) {
            try { rmSync(path.join(full, child.name), { recursive: true, force: true }); removed++; } catch { /* skip */ }
          }
        }
        continue;
      }

      // Legacy layout: .testpilot/<sessionId>/ at the root.
      if (ID_RE.test(name) && !sessionIds.has(name)) {
        try { rmSync(full, { recursive: true, force: true }); removed++; } catch { /* skip */ }
      }
    }

    if (removed > 0) {
      console.log(`[cleanup] removed ${removed} orphaned workspace folder(s) from .testpilot/`);
    }
  } catch (err) {
    console.log('[cleanup] workspace sweep skipped:', err instanceof Error ? err.message : String(err));
  }
}
