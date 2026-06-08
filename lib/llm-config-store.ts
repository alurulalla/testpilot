/**
 * LLM config store — persists the chosen provider & model (non-secret).
 *
 * Storage: <cwd>/.testpilot/llm-config.json
 *
 * API keys are NOT stored here and are NEVER read from environment variables —
 * they live in the per-organisation OrgApiKey table and are merged in by
 * getOrgLlmConfig(). This file only holds the provider/model/baseUrl selection.
 *
 * The config is read fresh on every request so changes take effect
 * immediately without a server restart.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { LlmConfig } from './pilot/model-factory';
import { DEFAULT_LLM_CONFIG } from './pilot/model-factory';
import { getOrgKeys } from './org-keys';

const CONFIG_DIR = path.join(process.cwd(), '.testpilot');

const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json');

/** Read the stored provider/model selection, falling back to the default. */
export function getLlmConfig(): LlmConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_LLM_CONFIG };
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      provider: parsed.provider ?? DEFAULT_LLM_CONFIG.provider,
      model:    parsed.model    ?? DEFAULT_LLM_CONFIG.model,
      // apiKey intentionally omitted — keys come only from the org store.
      baseUrl:  parsed.baseUrl  ?? undefined,
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

/**
 * Persist an LLM config.
 * Silently no-ops if the filesystem is read-only (should not happen — we use
 * /tmp on Vercel — but kept as a safety net for unexpected environments).
 */
export function saveLlmConfig(config: LlmConfig): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // EROFS = read-only filesystem, EACCES = permission denied — not a bug, skip silently.
    if (code === 'EROFS' || code === 'EACCES') return;
    throw err;
  }
}

/**
 * Return the stored config but with the apiKey masked for safe API responses.
 * The last 4 chars are shown so the user can identify which key is stored.
 */
export function getMaskedLlmConfig(): LlmConfig & { apiKeyMasked?: string } {
  const cfg = getLlmConfig();
  const { apiKey, ...rest } = cfg;
  if (!apiKey) return rest;
  const masked = apiKey.length > 4
    ? `${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}`
    : '****';
  return { ...rest, apiKey: undefined, apiKeyMasked: masked };
}

// ── Org-aware helpers ─────────────────────────────────────────────────────────

/** Provider → its well-known env-var name (mirrors model-factory.ts). */
const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  gemini:     'GOOGLE_API_KEY',
  groq:       'GROQ_API_KEY',
  mistral:    'MISTRAL_API_KEY',
  xai:        'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/**
 * Provider/model selection (from llm-config.json) merged with the org's API key.
 *
 * The API key comes EXCLUSIVELY from the org-level OrgApiKey table — never from
 * the config file and never from environment variables. If the org hasn't saved
 * a key for the active provider, apiKey is undefined and the model call fails
 * with a message pointing the user at Settings → AI → API Keys.
 *
 * Call this instead of getLlmConfig() in AI pipeline routes.
 */
export async function getOrgLlmConfig(orgId: string): Promise<LlmConfig> {
  const base = getLlmConfig();
  const orgKeys = await getOrgKeys(orgId);
  const envVar = PROVIDER_ENV_VAR[base.provider];
  const orgKey = envVar ? orgKeys[envVar] : undefined;
  return { ...base, apiKey: orgKey };
}

/**
 * The org's Figma token from the OrgApiKey table. Never falls back to env.
 *
 * Call this instead of getFigmaToken() in AI pipeline routes.
 */
export async function getOrgFigmaToken(orgId: string): Promise<string | undefined> {
  const orgKeys = await getOrgKeys(orgId);
  return orgKeys['FIGMA_TOKEN'] || undefined;
}
