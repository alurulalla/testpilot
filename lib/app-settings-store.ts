/**
 * App settings store — persists user-configurable runtime options.
 *
 * Storage: <cwd>/.testpilot/app-settings.json
 *
 * Resolution order for each value:
 *  1. Value saved via the UI settings panel (JSON file)
 *  2. Well-known environment variable
 *  3. Hard-coded default
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

export interface AppSettings {
  maxPages?:         number;
  deepCrawlMaxPages?: number;
  figmaToken?:       string;
  autoSelfHeal?:     boolean;
}

const CONFIG_DIR = path.join(process.cwd(), '.testpilot');

const SETTINGS_FILE = path.join(CONFIG_DIR, 'app-settings.json');

/** Read persisted app settings from disk. Returns {} if not yet saved. */
export function getAppSettings(): AppSettings {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    const raw = readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

/** Persist app settings, merging with whatever is already stored. */
export function saveAppSettings(incoming: Partial<AppSettings>): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const current = getAppSettings();
    const merged: AppSettings = { ...current };
    // Only overwrite keys that were explicitly sent
    if (incoming.maxPages          !== undefined) merged.maxPages          = incoming.maxPages;
    if (incoming.deepCrawlMaxPages !== undefined) merged.deepCrawlMaxPages = incoming.deepCrawlMaxPages;
    if (incoming.figmaToken        !== undefined) merged.figmaToken        = incoming.figmaToken || undefined;
    if (incoming.autoSelfHeal      !== undefined) merged.autoSelfHeal      = incoming.autoSelfHeal;
    writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // EROFS = read-only filesystem, EACCES = permission denied — not a bug.
    if (code === 'EROFS' || code === 'EACCES') return;
    throw err;
  }
}

/**
 * Return settings safe for the client — figmaToken is masked to last 4 chars.
 */
export function getMaskedAppSettings(): Omit<AppSettings, 'figmaToken'> & {
  figmaTokenMasked?: string;
  figmaTokenSet: boolean;
} {
  const s = getAppSettings();
  const { figmaToken, ...rest } = s;
  const figmaTokenSet = Boolean(figmaToken || process.env.FIGMA_TOKEN);
  if (!figmaToken) return { ...rest, figmaTokenSet };
  const masked =
    figmaToken.length > 4
      ? `${'*'.repeat(Math.min(figmaToken.length - 4, 10))}${figmaToken.slice(-4)}`
      : '****';
  return { ...rest, figmaTokenSet, figmaTokenMasked: masked };
}
