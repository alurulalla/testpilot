/**
 * Persistent per-URL context store
 *
 * Context holds form-field values the user has provided for a given site
 * (e.g. login credentials, search terms).  Stored in the ContextStore DB
 * table so they survive server restarts and are scoped to an organisation.
 *
 * All public functions are async.  Pure transformation helpers
 * (contextToEnv, contextToPromptHint) remain synchronous.
 */
import { prisma } from '@/lib/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextField {
  /** Machine-readable key derived from name/id/placeholder */
  key: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** HTML input type */
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reduce a URL to just the origin so https://example.com/any/path → https://example.com */
export function urlKey(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}

function rowToContext(row: { urlKey: string; url: string; fields: unknown; updatedAt: Date }): UrlContext {
  return {
    urlKey:    row.urlKey,
    url:       row.url,
    fields:    row.fields as ContextField[],
    updatedAt: row.updatedAt.getTime(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getUrlContext(url: string, orgId: string): Promise<UrlContext | null> {
  const row = await prisma.contextStore.findUnique({
    where: { orgId_urlKey: { orgId, urlKey: urlKey(url) } },
  });
  return row ? rowToContext(row) : null;
}

export async function saveUrlContext(
  url: string,
  fields: ContextField[],
  orgId: string,
): Promise<UrlContext> {
  const key = urlKey(url);
  const row = await prisma.contextStore.upsert({
    where:  { orgId_urlKey: { orgId, urlKey: key } },
    create: { orgId, urlKey: key, url, fields: fields as object[] },
    update: { url, fields: fields as object[] },
  });
  return rowToContext(row);
}

export async function deleteUrlContext(url: string, orgId: string): Promise<void> {
  await prisma.contextStore.deleteMany({
    where: { orgId, urlKey: urlKey(url) },
  });
}

export async function listUrlContexts(orgId: string): Promise<UrlContext[]> {
  const rows = await prisma.contextStore.findMany({
    where:   { orgId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(rowToContext);
}

// ── Pure transformation helpers (unchanged) ───────────────────────────────────

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
      return `  ${f.label || f.key}: process.env.${envKey}  (set in workspace .env)`;
    }
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
