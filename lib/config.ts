import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAppSettings } from './app-settings-store';

/**
 * Return the root directory used for all per-session workspaces (.testpilot/).
 * All API routes should call this helper instead of hardcoding `process.cwd()`.
 */
export function getTestpilotRoot(): string {
  // turbopackIgnore tells Turbopack's bundler not to trace files under this
  // path — it is a runtime-only directory, never part of the JS bundle.
  return join(/*turbopackIgnore: true*/ process.cwd(), '.testpilot');
}

/**
 * Return the workspace directory for a specific session.
 *
 * New layout:  .testpilot/{orgId}/{sessionId}/
 * Legacy layout: .testpilot/{sessionId}/   (used when migrating existing sessions)
 *
 * If the org-scoped path does not yet exist but the legacy path does, the
 * legacy path is returned so existing sessions keep working without a manual
 * migration step.
 */
export function getSessionDir(sessionId: string, orgId: string): string {
  const root = getTestpilotRoot();
  // turbopackIgnore: runtime-only paths — never bundled, must not be traced.
  const orgPath    = join(/*turbopackIgnore: true*/ root, orgId, sessionId);
  const legacyPath = join(/*turbopackIgnore: true*/ root, sessionId);
  if (!existsSync(orgPath) && existsSync(legacyPath)) return legacyPath;
  return orgPath;
}

function readEnvLocal(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      result[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {
    // file not found or unreadable
  }
  return result;
}

export function getMaxPages(): number {
  const stored = getAppSettings().maxPages;
  if (stored != null && stored > 0) return stored;
  const raw = process.env.MAX_PAGES || readEnvLocal().MAX_PAGES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * Maximum pages to crawl when the user has authenticated credentials.
 * Authenticated crawls go deeper because they can reach protected pages.
 * Set DEEP_CRAWL_MAX_PAGES in .env.local to override (default: 50).
 */
export function getDeepCrawlMaxPages(): number {
  const stored = getAppSettings().deepCrawlMaxPages;
  if (stored != null && stored > 0) return stored;
  const raw = process.env.DEEP_CRAWL_MAX_PAGES || readEnvLocal().DEEP_CRAWL_MAX_PAGES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

/**
 * Global app-settings Figma token (file-based, non-org). NOT read from env.
 * AI pipelines use getOrgFigmaToken() (org DB) instead — this remains only for
 * the global App Settings UI display.
 */
export function getFigmaToken(): string | undefined {
  return getAppSettings().figmaToken || undefined;
}

/**
 * Auto self-heal mode — checked at loop start so changes take effect immediately.
 *   false (default) → user must manually trigger self-healing
 *   true            → self-heal runs automatically after every failing run
 */
export function getAutoSelfHeal(): boolean {
  const stored = getAppSettings().autoSelfHeal;
  if (stored != null) return stored;
  return process.env.AUTO_SELF_HEAL === 'true';
}
