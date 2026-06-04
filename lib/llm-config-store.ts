/**
 * LLM config store — persists the user's chosen provider, model, and API key.
 *
 * Storage: <cwd>/.testpilot/llm-config.json
 *
 * Key resolution order:
 *  1. Value saved via the UI settings panel (JSON file)
 *  2. Well-known environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 *  3. Default config (no key — model will fail at call-time with a helpful message)
 *
 * The config is read fresh on every request so changes take effect
 * immediately without a server restart.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { LlmConfig } from './pilot/model-factory';
import { DEFAULT_LLM_CONFIG } from './pilot/model-factory';

const CONFIG_DIR = path.join(process.cwd(), '.testpilot');

const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json');

/**
 * Build a best-effort config from well-known environment variables.
 * Checked in order of preference; first match wins.
 */
function buildConfigFromEnv(): LlmConfig {
  const envMap: Array<[string, string, string]> = [
    ['ANTHROPIC_API_KEY',   'anthropic',  'claude-sonnet-4-6'],
    ['OPENAI_API_KEY',      'openai',     'gpt-4o'],
    ['GOOGLE_API_KEY',      'gemini',     'gemini-2.0-flash'],
    ['GROQ_API_KEY',        'groq',       'llama-3.3-70b-versatile'],
    ['MISTRAL_API_KEY',     'mistral',    'mistral-large-latest'],
    ['XAI_API_KEY',         'xai',        'grok-2-latest'],
    ['OPENROUTER_API_KEY',  'openrouter', 'openai/gpt-4o'],
  ];
  for (const [envVar, provider, model] of envMap) {
    const key = process.env[envVar];
    if (key) return { provider, model, apiKey: key };
  }
  return { ...DEFAULT_LLM_CONFIG };
}

/** Read the stored LLM config, falling back to env vars then the default. */
export function getLlmConfig(): LlmConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return buildConfigFromEnv();
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    const envFallback = buildConfigFromEnv();
    return {
      provider: parsed.provider ?? envFallback.provider,
      model:    parsed.model    ?? envFallback.model,
      // Prefer the explicitly saved key; fall back to env var so Vercel deployments
      // automatically pick up keys set in the Vercel dashboard.
      apiKey:   parsed.apiKey   || envFallback.apiKey,
      baseUrl:  parsed.baseUrl  ?? undefined,
    };
  } catch {
    return buildConfigFromEnv();
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
