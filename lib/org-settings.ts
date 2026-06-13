/**
 * Org-scoped app settings, stored on Organization.settings (Json).
 *
 * Replaces the old <cwd>/.testpilot/app-settings.json file, which lived on the
 * container disk and was wiped on every redeploy — and was global rather than
 * per-organisation.
 *
 * Resolution order per field: DB value → environment variable → default.
 */
import { prisma } from '@/lib/prisma';

export interface OrgSettings {
  maxPages: number;
  deepCrawlMaxPages: number;
  autoSelfHeal: boolean;
}

/** Raw stored shape — all fields optional (absent = use env/default). */
export interface OrgSettingsPatch {
  maxPages?: number;
  deepCrawlMaxPages?: number;
  autoSelfHeal?: boolean;
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  let stored: OrgSettingsPatch = {};
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    stored = (org?.settings ?? {}) as OrgSettingsPatch;
  } catch { /* fall back to env/defaults */ }

  return {
    maxPages:          stored.maxPages          ?? envInt('MAX_PAGES', 10),
    deepCrawlMaxPages: stored.deepCrawlMaxPages ?? envInt('DEEP_CRAWL_MAX_PAGES', 50),
    autoSelfHeal:      stored.autoSelfHeal      ?? (process.env.AUTO_SELF_HEAL === 'true'),
  };
}

/** Merge a patch into the org's stored settings. */
export async function saveOrgSettings(orgId: string, patch: OrgSettingsPatch): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const merged = { ...((org?.settings ?? {}) as OrgSettingsPatch), ...patch };
  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: merged },
  });
}
