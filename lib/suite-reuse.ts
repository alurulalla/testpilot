/**
 * Suite reuse — avoid regenerating the same tests for an unchanged app.
 *
 * When a session crawls an app we've tested before (same org + same origin) and
 * the crawl surfaces no NEW features, we copy the previous suite instead of
 * spending tokens regenerating identical specs. Generation is the expensive
 * step; crawling + one feature-synthesis call is cheap, and that's what tells
 * us whether anything actually changed.
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import type { Workspace } from '@/lib/pilot';
import { originOf } from '@/lib/scenarios';

interface PriorSuiteFile { path: string; content: string }
export interface PriorSuite {
  sessionId: string;
  files: PriorSuiteFile[];
  specCount: number;
  featureNames: string[];
}

function kindForPath(p: string): string {
  if (p.startsWith('tests/figma/')) return 'figma';
  if (p === 'tests/fixtures.ts') return 'fixture';
  if (p.startsWith('tests/')) return p.includes('scenario-') ? 'scenario' : 'generated';
  return 'sidecar';
}

/** Most recent prior session (same org + origin) that has a stored suite. */
export async function findPriorSuite(
  orgId: string, url: string, excludeSessionId: string,
): Promise<PriorSuite | null> {
  try {
    const origin = originOf(url);
    const candidates = await prisma.session.findMany({
      where: { orgId, id: { not: excludeSessionId } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, url: true },
      take: 50,
    });
    for (const c of candidates) {
      if (originOf(c.url) !== origin) continue;
      const files = await prisma.sessionFile.findMany({
        where: { sessionId: c.id, deletedAt: null },
        select: { path: true, content: true },
      });
      const specs = files.filter(f => f.path.endsWith('.spec.ts'));
      if (specs.length === 0) continue;

      let featureNames: string[] = [];
      const feat = files.find(f => f.path === 'features.json');
      if (feat) {
        try {
          featureNames = (JSON.parse(feat.content) as { name?: string }[])
            .map(x => (x.name ?? '').toLowerCase().trim()).filter(Boolean);
        } catch { /* ignore */ }
      }
      return { sessionId: c.id, files, specCount: specs.length, featureNames };
    }
  } catch { /* fall through */ }
  return null;
}

/** Copy a prior suite's files into this session's workspace (disk + DB). Returns spec abs paths. */
export async function copySuiteInto(
  sessionId: string, workspace: Workspace, files: PriorSuiteFile[],
): Promise<string[]> {
  const specPaths: string[] = [];
  for (const f of files) {
    const abs = path.join(workspace.dir, f.path);
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, f.content, 'utf8');
    } catch { continue; }
    await prisma.sessionFile.upsert({
      where: { sessionId_path: { sessionId, path: f.path } },
      create: { sessionId, path: f.path, content: f.content, kind: kindForPath(f.path) },
      update: { content: f.content, kind: kindForPath(f.path), deletedAt: null },
    }).catch(() => {});
    if (f.path.endsWith('.spec.ts')) specPaths.push(abs);
  }
  return specPaths;
}

/** Feature names the current crawl synthesized (from features.json on disk). */
export function currentFeatureNames(workspace: Workspace): string[] {
  try {
    const feats = workspace.readFeatures() as { name?: string }[] | null;
    return (feats ?? []).map(x => (x.name ?? '').toLowerCase().trim()).filter(Boolean);
  } catch { return []; }
}
