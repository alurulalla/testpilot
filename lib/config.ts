import { readFileSync } from 'fs';
import { join } from 'path';

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

export function getAnthropicKey(): string | undefined {
  // Check process.env first (set via shell or Docker), then fall back to .env.local
  return process.env.ANTHROPIC_API_KEY || readEnvLocal().ANTHROPIC_API_KEY || undefined;
}

export function getMaxPages(): number {
  const raw = process.env.MAX_PAGES || readEnvLocal().MAX_PAGES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function getFigmaToken(): string | undefined {
  return process.env.FIGMA_TOKEN || readEnvLocal().FIGMA_TOKEN || undefined;
}
