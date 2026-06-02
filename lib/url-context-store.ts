/**
 * Persistent per-URL context store.
 *
 * Context holds form-field values the user has provided for a given site
 * (e.g. login credentials, search terms).  Stored in .testpilot/contexts.json
 * so they survive server restarts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getTestpilotRoot } from './config';

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

const STORE_PATH = path.join(getTestpilotRoot(), 'contexts.json');

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
 *
 * Format is designed to prevent two common LLM mistakes:
 *  1. Using a human-readable label like "User Name" as a getByLabel() argument
 *     when the actual HTML label might be "UserName" (different casing/spacing).
 *  2. Leaving `process.env.X ?? ''` which produces an empty string when the
 *     variable isn't loaded yet.
 *
 * We show the env-var name alongside the hint so the LLM can read both the
 * env var AND fall back to the non-sensitive literal username value.
 */
export function contextToPromptHint(ctx: UrlContext): string {
  const fields = ctx.fields.filter(f => f.value);
  if (fields.length === 0) return '';

  const lines = fields.map(f => {
    const envKey = `TESTPILOT_${f.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    if (f.sensitive) {
      // Show the env var name — the actual value is in the workspace .env file
      return `  ${f.label || f.key}: process.env.${envKey}  (set in workspace .env)`;
    }
    // Non-sensitive (e.g. username) — show the value directly so LLM never guesses
    return `  ${f.label || f.key}: "${f.value}"  (env: process.env.${envKey})`;
  });

  return (
    `The following credentials are configured for this site:\n${lines.join('\n')}\n` +
    `IMPORTANT: In generated tests, use process.env.<VAR_NAME> for sensitive fields. ` +
    `The values are loaded from the workspace .env file at test runtime. ` +
    `Do NOT use the label text (e.g. "User Name") as a getByLabel() argument — ` +
    `use the actual HTML label or aria-label visible in the crawl data instead.`
  );
}
