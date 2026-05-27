/**
 * Persistent per-URL context store.
 *
 * Context holds form-field values the user has provided for a given site
 * (e.g. login credentials, search terms).  Stored in .testpilot/contexts.json
 * so they survive server restarts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextField {
  /** Machine-readable key derived from name/id/placeholder */
  key: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** HTML input type  */
  type: string;
  /** Value provided by the user */
  value: string;
  /** True for password / token / secret fields — UI masks the value */
  sensitive: boolean;
}

export interface UrlContext {
  /** Canonical URL key (origin only, e.g. https://example.com) */
  urlKey: string;
  /** Original URL as entered by the user */
  url: string;
  fields: ContextField[];
  updatedAt: number;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), '.testpilot', 'contexts.json');

function readStore(): Record<string, UrlContext> {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Record<string, UrlContext>;
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, UrlContext>): void {
  mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** Reduce a URL to just the origin so https://example.com/any/path → https://example.com */
export function urlKey(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getUrlContext(url: string): UrlContext | null {
  return readStore()[urlKey(url)] ?? null;
}

export function saveUrlContext(url: string, fields: ContextField[]): UrlContext {
  const store = readStore();
  const key = urlKey(url);
  const ctx: UrlContext = { urlKey: key, url, fields, updatedAt: Date.now() };
  store[key] = ctx;
  writeStore(store);
  return ctx;
}

export function deleteUrlContext(url: string): void {
  const store = readStore();
  delete store[urlKey(url)];
  writeStore(store);
}

export function listUrlContexts(): UrlContext[] {
  return Object.values(readStore()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Convert stored context fields into a flat key→value map suitable for
 * writing to a .env file or injecting into prompts.
 * Keys are uppercased: TESTPILOT_<field.key>
 */
export function contextToEnv(ctx: UrlContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of ctx.fields) {
    if (f.value) {
      const envKey = `TESTPILOT_${f.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      env[envKey] = f.value;
    }
  }
  return env;
}

/**
 * Summarise a context for inclusion in a Claude prompt.
 * Sensitive values are redacted so credentials aren't logged.
 */
export function contextToPromptHint(ctx: UrlContext): string {
  const lines = ctx.fields
    .filter(f => f.value)
    .map(f => `  ${f.label || f.key}: ${f.sensitive ? '[PROVIDED — use process.env.TESTPILOT_' + f.key.toUpperCase() + ']' : f.value}`);
  if (lines.length === 0) return '';
  return `The following context values are available for this site:\n${lines.join('\n')}\nFor sensitive values, read them from the environment variable shown above.`;
}
