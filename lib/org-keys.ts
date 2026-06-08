/**
 * org-keys.ts — Phase 8
 *
 * Fetches and decrypts API keys stored per-organisation in the OrgApiKey table.
 * The decrypted values are returned as a plain object keyed by keyName
 * (ANTHROPIC_API_KEY, FIGMA_TOKEN, OPENAI_API_KEY, …).
 *
 * These keys take precedence over process.env equivalents so each org can
 * supply its own credentials without touching server environment variables.
 */
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';

export type OrgKeyMap = Partial<Record<string, string>>;

/**
 * Return all decrypted API keys for an organisation.
 * Keys that fail decryption are silently omitted so a corrupt row
 * doesn't break the entire pipeline.
 */
export async function getOrgKeys(orgId: string): Promise<OrgKeyMap> {
  const rows = await prisma.orgApiKey.findMany({ where: { orgId } });
  const result: OrgKeyMap = {};
  for (const row of rows) {
    try {
      result[row.keyName] = decrypt(row.keyValue);
    } catch {
      // Decryption failure — skip this key; caller will fall back to process.env
    }
  }
  return result;
}
