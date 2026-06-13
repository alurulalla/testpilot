/**
 * Scenario persistence — saved "Test a Scenario" requests, per org + URL.
 *
 * Lets us: list the scenarios a user asked for in a session, and surface
 * scenarios they previously checked for the SAME target app (same origin) so
 * they can re-add a known test in one click — without re-generating it.
 */
import { prisma } from '@/lib/prisma';

export function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

export interface ScenarioRow {
  id: string;
  description: string;
  testPath: string | null;
  lastStatus: string | null;
  createdAt: number;
}

export interface RecordScenarioInput {
  orgId: string;
  sessionId: string;
  url: string;
  description: string;
  testPath?: string | null;
  lastStatus?: string | null;
}

/** Insert or update a scenario for this session (keyed by description). */
export async function recordScenario(input: RecordScenarioInput): Promise<void> {
  try {
    await prisma.scenario.upsert({
      where: { sessionId_description: { sessionId: input.sessionId, description: input.description } },
      create: {
        orgId:       input.orgId,
        sessionId:   input.sessionId,
        urlOrigin:   originOf(input.url),
        description: input.description,
        testPath:    input.testPath ?? null,
        lastStatus:  input.lastStatus ?? null,
      },
      update: {
        testPath:   input.testPath ?? undefined,
        lastStatus: input.lastStatus ?? undefined,
      },
    });
  } catch { /* best-effort */ }
}

/** Scenarios requested in THIS session, newest first. */
export async function listSessionScenarios(sessionId: string): Promise<ScenarioRow[]> {
  try {
    const rows = await prisma.scenario.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => ({
      id: r.id, description: r.description, testPath: r.testPath,
      lastStatus: r.lastStatus, createdAt: r.createdAt.getTime(),
    }));
  } catch { return []; }
}

/**
 * Scenarios the org previously checked for the SAME target origin in OTHER
 * sessions — deduped by description, so the user can re-add them here.
 */
export async function listPriorScenarios(
  orgId: string, url: string, excludeSessionId: string,
): Promise<ScenarioRow[]> {
  try {
    const rows = await prisma.scenario.findMany({
      where: { orgId, urlOrigin: originOf(url), sessionId: { not: excludeSessionId } },
      orderBy: { createdAt: 'desc' },
    });
    // Descriptions already present in THIS session — don't offer to "Add" a
    // scenario the user already has here (otherwise the button never goes away).
    const here = await prisma.scenario.findMany({
      where: { sessionId: excludeSessionId },
      select: { description: true },
    });
    const seen = new Set<string>(here.map(r => r.description.trim().toLowerCase()));
    const out: ScenarioRow[] = [];
    for (const r of rows) {
      const key = r.description.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: r.id, description: r.description, testPath: r.testPath,
        lastStatus: r.lastStatus, createdAt: r.createdAt.getTime(),
      });
    }
    return out;
  } catch { return []; }
}

export async function getScenario(id: string): Promise<{ id: string; sessionId: string; orgId: string; testPath: string | null; description: string } | null> {
  try {
    const r = await prisma.scenario.findUnique({ where: { id } });
    return r ? { id: r.id, sessionId: r.sessionId, orgId: r.orgId, testPath: r.testPath, description: r.description } : null;
  } catch { return null; }
}

export async function deleteScenario(id: string): Promise<void> {
  try { await prisma.scenario.delete({ where: { id } }); } catch { /* already gone */ }
}
